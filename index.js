import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import {
  HttpFetchProvider,
  DEFAULT_USER_AGENT,
} from "@deepseek-ai/dsh-web-fetch-http";
import { WebError } from "@deepseek-ai/dsh-web";
import { timeoutOf } from "@deepseek-ai/dsh-timeout";
import ipaddr from "ipaddr.js";
import z from "@deepseek-ai/schemastery";

export const name = "web-fetch-fakeip";
export const inject = ["web", "scopedHttpProxy"];
export const Config = z.object({
  maxResponseBytes: z.number().default(5000000),
  maxBodyChars: z.number().default(100000),
  timeoutMs: z.number().default(30000),
  maxRedirects: z.number().default(5),
  userAgent: z.string().default(DEFAULT_USER_AGENT),
});

// Only the configured Clash pool is eligible. A non-public address alone is
// never evidence of Fake-IP: private, loopback, link-local and mixed sets fail closed.
export function isFakeIpAnswerSet(entries) {
  return (
    entries.length > 0 &&
    entries.every(({ address }) => {
      if (!ipaddr.isValid(address)) return false;
      let parsed = ipaddr.parse(address);
      if (parsed.kind() === "ipv6" && parsed.isIPv4MappedAddress())
        parsed = parsed.toIPv4Address();
      return (
        parsed.kind() === "ipv4" && parsed.match(ipaddr.parse("198.18.0.0"), 16)
      );
    })
  );
}

function assertNotAborted(signal) {
  if (timeoutOf(signal, "WEB_FETCH_TIMEOUT")) {
    throw new WebError("web fetch timed out", "WEB_FETCH_TIMEOUT");
  }
  if (signal.aborted) throw new WebError("web fetch aborted", "WEB_ABORTED");
}

async function lookupWithSignal(hostname, signal) {
  assertNotAborted(signal);
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    lookup(hostname, { all: true, order: "verbatim" })
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

export class FakeIpFetchProvider extends HttpFetchProvider {
  constructor(config = {}, proxyTransport) {
    const resolved = Config(config);
    for (const key of ["maxResponseBytes", "maxBodyChars", "timeoutMs"]) {
      if (!Number.isSafeInteger(resolved[key]) || resolved[key] <= 0)
        throw new Error(`${key} must be a positive safe integer`);
    }
    if (resolved.timeoutMs > 2147483647)
      throw new Error("timeoutMs exceeds Node timer limit");
    if (
      !Number.isSafeInteger(resolved.maxRedirects) ||
      resolved.maxRedirects < 0
    )
      throw new Error("maxRedirects must be a non-negative integer");
    super(resolved);
    this.proxyTransport = proxyTransport;
  }

  async requestOnce(url, signal) {
    // Reject explicit local targets before considering either transport.
    const hostname = url.hostname
      .replace(/^\[|\]$/g, "")
      .replace(/\.$/, "")
      .toLowerCase();
    let blocked =
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      (!hostname.includes(".") && !isIP(hostname));
    if (isIP(hostname)) {
      let address = ipaddr.parse(hostname);
      if (address.kind() === "ipv6" && address.isIPv4MappedAddress())
        address = address.toIPv4Address();
      blocked ||= address.range() !== "unicast";
    }
    if (blocked)
      throw new WebError("Non-public URL target is blocked", "WEB_BLOCKED_URL");
    try {
      // The stock transport validates AND pins public DNS answers, including its
      // NAT64 protections. Preserve that path rather than implementing new DNS rules.
      return await this.requestDirect(url, signal);
    } catch (error) {
      if (error?.code !== "WEB_BLOCKED_URL" || isIP(hostname)) throw error;
      let entries;
      try {
        entries = await this.lookupForFallback(hostname, signal);
      } catch {
        assertNotAborted(signal);
        throw error;
      }
      if (!isFakeIpAnswerSet(entries)) throw error;
      assertNotAborted(signal);
      return this.requestProxy(url, signal);
    }
  }

  requestDirect(url, signal) {
    return super.requestOnce(url, signal);
  }
  lookupForFallback(hostname, signal) {
    return lookupWithSignal(hostname, signal);
  }

  async requestProxy(url, signal) {
    if (!this.proxyTransport)
      throw new WebError(
        "Install dsh-scoped-http-proxy to provide the scopedHttpProxy service",
        "WEB_PROVIDER_CONFIGURED_MISSING",
      );
    try {
      const response = await this.proxyTransport.fetch(url, {
        method: "GET",
        redirect: "manual",
        signal,
        headers: {
          "user-agent": this.limits.userAgent,
          accept:
            "text/html,application/xhtml+xml,text/*;q=0.9,application/json;q=0.8",
        },
      });
      return { response, close: async () => {} };
    } catch (error) {
      assertNotAborted(signal);
      throw new WebError(
        "Proxy connection failed; check that Clash is running on the configured port",
        "WEB_PROVIDER_ERROR",
        { cause: error },
      );
    }
  }
}

export function apply(ctx, config) {
  const provider = new FakeIpFetchProvider(config, ctx.scopedHttpProxy);
  ctx.web.registerFetchProvider(provider);
}
