import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { once } from "node:events";
import { getGlobalDispatcher } from "undici";
import { FakeIpFetchProvider } from "../index.js";

// A real HTTP proxy maps the public-looking test hostname to a local
// origin. No internet, external proxy, API credentials, or fake system DNS needed.
async function fixture(t, config = {}) {
  const sockets = new Set();
  const connections = [];
  const origin = http.createServer((req, res) => {
    if (req.url === "/redirect") {
      res.writeHead(302, { location: "/text" }).end();
    } else if (req.url === "/cross-origin") {
      res.writeHead(302, { location: "http://127.0.0.1/private" }).end();
    } else if (req.url === "/slow") {
      // Leave pending until the request's deadline destroys the connection.
    } else {
      res
        .writeHead(200, { "content-type": "text/plain", "content-length": 11 })
        .end("Hello proxy");
    }
  });
  const proxy = http.createServer((req, res) => {
    const target = new URL(req.url);
    connections.push(target.host + (target.port ? "" : ":80"));
    const forwarded = http.request(
      {
        hostname: "127.0.0.1",
        port: origin.address().port,
        path: target.pathname,
        method: req.method,
      },
      (upstream) => {
        res.writeHead(upstream.statusCode, upstream.headers);
        upstream.pipe(res);
      },
    );
    forwarded.on("error", () => res.destroy());
    res.on("close", () => forwarded.destroy());
    req.pipe(forwarded);
  });
  for (const server of [origin, proxy]) {
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
  }
  proxy.on("connect", (req, client, head) => {
    connections.push(req.url);
    const upstream = net.connect(origin.address().port, "127.0.0.1");
    sockets.add(upstream);
    upstream.on("close", () => sockets.delete(upstream));
    upstream.on("error", () => client.destroy());
    client.on("error", () => upstream.destroy());
    upstream.once("connect", () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      upstream.pipe(client).pipe(upstream);
    });
  });
  const provider = new FakeIpFetchProvider({
    proxyUrl: `http://127.0.0.1:${proxy.address().port}`,
    ...config,
  });
  provider.requestDirect = async () => {
    throw Object.assign(new Error("Fake-IP rejected by host"), {
      code: "WEB_BLOCKED_URL",
    });
  };
  provider.lookupForFallback = async () => [
    { address: "198.18.0.183", family: 4 },
  ];
  t.after(async () => {
    await provider.dispose();
    for (const socket of sockets) socket.destroy();
    await Promise.all(
      [origin, proxy].map(
        (server) => new Promise((resolve) => server.close(resolve)),
      ),
    );
  });
  return { provider, connections };
}

test("real HTTP proxy fetch leaves process environment and global transport untouched", async (t) => {
  const env = { ...process.env };
  const dispatcher = getGlobalDispatcher();
  const fetch = globalThis.fetch;
  const { provider, connections } = await fixture(t);
  const result = await provider.fetch({ url: "http://example.test/text" });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.content, "Hello proxy");
  assert.ok(connections.includes("example.test:80"));
  assert.deepEqual({ ...process.env }, env);
  assert.equal(getGlobalDispatcher(), dispatcher);
  assert.equal(globalThis.fetch, fetch);
  await provider.dispose();
  assert.equal(getGlobalDispatcher(), dispatcher);
  assert.deepEqual({ ...process.env }, env);
});

test("host still handles same-origin redirects", async (t) => {
  const { provider } = await fixture(t);
  const result = await provider.fetch({ url: "http://example.test/redirect" });
  assert.equal(result.url, "http://example.test/text");
  assert.equal(result.body.content, "Hello proxy");
});

test("host blocks redirects to another origin before sending a request", async (t) => {
  const { provider, connections } = await fixture(t);
  await assert.rejects(
    provider.fetch({ url: "http://example.test/cross-origin" }),
    { code: "WEB_REDIRECT_BLOCKED" },
  );
  assert.ok(connections.every((authority) => authority === "example.test:80"));
});

test("host enforces response size and character limits", async (t) => {
  const { provider } = await fixture(t, { maxResponseBytes: 5 });
  await assert.rejects(provider.fetch({ url: "http://example.test/text" }), {
    code: "WEB_FETCH_TOO_LARGE",
  });
  const other = await fixture(t, { maxBodyChars: 5 });
  const result = await other.provider.fetch({
    url: "http://example.test/text",
  });
  assert.equal(result.body.content, "Hello");
  assert.equal(result.truncated, true);
});

test("proxy request observes the host deadline", async (t) => {
  const { provider } = await fixture(t, { timeoutMs: 100 });
  await assert.rejects(provider.fetch({ url: "http://example.test/slow" }), {
    code: "WEB_FETCH_TIMEOUT",
  });
});
