import test from "node:test";
import assert from "node:assert/strict";
import { FakeIpFetchProvider } from "../index.js";
test("local targets, URL credentials and non-HTTP schemes remain blocked", async () => {
  const p = new FakeIpFetchProvider();
  try {
    for (const url of [
      "http://127.0.0.1",
      "http://192.168.1.1",
      "http://198.18.0.183",
      "http://[::1]",
      "http://[::ffff:127.0.0.1]",
      "http://localhost",
      "http://test.local",
      "https://user:password@example.com",
      "file:///etc/hosts",
    ]) {
      await assert.rejects(p.fetch({ url }));
    }
  } finally {
    await p.dispose();
  }
});

test("cancelled request is not sent", async () => {
  const p = new FakeIpFetchProvider();
  try {
    await assert.rejects(
      p.fetch({ url: "https://example.com" }, AbortSignal.abort()),
      { code: "WEB_ABORTED" },
    );
  } finally {
    await p.dispose();
  }
});

test("proxy outage fails without falling back to direct access", async () => {
  const p = new FakeIpFetchProvider({
    proxyUrl: "http://127.0.0.1:1",
    timeoutMs: 2000,
  });
  p.requestDirect = async () => {
    throw blocked();
  };
  p.lookupForFallback = async () => [{ address: "198.18.0.1", family: 4 }];
  try {
    await assert.rejects(p.fetch({ url: "https://example.com" }), {
      code: "WEB_PROVIDER_ERROR",
    });
  } finally {
    await p.dispose();
  }
});

const blocked = () =>
  Object.assign(new Error("blocked by stock DNS validation"), {
    code: "WEB_BLOCKED_URL",
  });
const url = new URL("https://example.com/page");

test("public DNS success keeps stock transport and never resolves again or allocates proxy", async () => {
  const p = new FakeIpFetchProvider();
  const expected = { response: "stock direct result" };
  p.requestDirect = async () => expected;
  p.lookupForFallback = async () =>
    assert.fail("unnecessary second DNS lookup");
  p.requestProxy = async () => assert.fail("unexpected proxy");
  assert.equal(
    await p.requestOnce(url, new AbortController().signal),
    expected,
  );
  assert.equal(p.dispatcher, undefined);
});

test("only a fully Fake-IP DNS answer set triggers proxy after stock rejection", async () => {
  const p = new FakeIpFetchProvider();
  const originalError = blocked();
  p.requestDirect = async () => {
    throw originalError;
  };
  let proxyCalls = 0;
  p.requestProxy = async () => {
    proxyCalls++;
    return "proxied";
  };
  for (const addresses of [
    ["198.18.0.183"],
    ["198.18.0.3", "198.18.255.254"],
    ["::ffff:198.18.0.3"],
  ]) {
    p.lookupForFallback = async () => addresses.map((address) => ({ address }));
    assert.equal(
      await p.requestOnce(url, new AbortController().signal),
      "proxied",
    );
  }
  assert.equal(proxyCalls, 3);
  for (const addresses of [
    [],
    ["192.168.1.1"],
    ["127.0.0.1"],
    ["169.254.169.254"],
    ["::1"],
    ["fc00::1"],
    ["8.8.8.8"],
    ["198.19.0.1"],
    ["198.18.0.3", "192.168.1.1"],
    ["198.18.0.3", "8.8.8.8"],
  ]) {
    p.lookupForFallback = async () => addresses.map((address) => ({ address }));
    await assert.rejects(
      p.requestOnce(url, new AbortController().signal),
      (e) => e === originalError,
    );
  }
  assert.equal(proxyCalls, 3);
});

test("network, TLS and timeout failures do not trigger proxy fallback", async () => {
  const p = new FakeIpFetchProvider();
  p.lookupForFallback = async () =>
    assert.fail("must not resolve for fallback");
  p.requestProxy = async () => assert.fail("must not proxy");
  for (const code of [
    "WEB_PROVIDER_ERROR",
    "WEB_FETCH_TIMEOUT",
    "WEB_ABORTED",
  ]) {
    const error = Object.assign(new Error(code), { code });
    p.requestDirect = async () => {
      throw error;
    };
    await assert.rejects(
      p.requestOnce(url, new AbortController().signal),
      (e) => e === error,
    );
  }
});

test("a second DNS failure preserves original rejection", async () => {
  const p = new FakeIpFetchProvider();
  const error = blocked();
  p.requestDirect = async () => {
    throw error;
  };
  p.lookupForFallback = async () => {
    throw new Error("DNS unavailable");
  };
  p.requestProxy = async () => assert.fail("must not proxy");
  await assert.rejects(
    p.requestOnce(url, new AbortController().signal),
    (e) => e === error,
  );
});
