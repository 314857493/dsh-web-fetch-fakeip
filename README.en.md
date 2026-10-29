# dsh-web-fetch-fakeip

[中文](README.md) · [MIT License](LICENSE)

Conditional Fake-IP fallback for DeepSeek Harness / DSH Desktop `web_fetch`.

Clash Fake-IP DNS may return a synthetic address for a public hostname. DSH rejects that address before making an HTTP request, producing `WEB_BLOCKED_URL` even though search can still return links.

This plugin preserves the stock HTTP transport. It calls the separate `scopedHttpProxy` service **only after a stock `WEB_BLOCKED_URL` rejection and a second DNS lookup whose entire answer set belongs to `198.18.0.0/16`**. It does not alter system proxies, Clash configuration, environment variables, global `fetch`, or the global dispatcher.

## Install

Requires Node.js 22.19+ and DSH components `@deepseek-ai/dsh-web-fetch-http`, `@deepseek-ai/dsh-web`, and `@deepseek-ai/dsh-timeout` at `0.2.1-rc.4`. Other host versions have not been verified. The plugin extends the exported `HttpFetchProvider` but relies on its implementation-level `requestOnce` method.

```sh
dsh plugin --profile web add 'git+https://github.com/314857493/dsh-scoped-http-proxy.git#v0.1.1'
dsh plugin --profile web add 'git+https://github.com/314857493/dsh-web-fetch-fakeip.git#v0.4.0'
```

Restart DSH after installation. If migrating from the earlier local `dsh-web-fetch-proxy` package, remove that package first; both implementations register provider id `http` and cannot be enabled together.

The project is distributed through GitHub, not npm. The Chinese README includes the bundled macOS Desktop CLI command when `dsh` is not on PATH.

## Configure

Since 0.4.0, install both packages. Configure the proxy in **Plugins → Scoped HTTP proxy**. New requests use the saved address immediately. Move any old `web-fetch-fakeip.config.proxyUrl` override to `scoped-http-proxy.config.proxyUrl`. This adapter owns only Fake-IP routing; the independent service owns transport.

Default proxy: `http://127.0.0.1:7897`. Set your HTTP/mixed proxy port in the profile's `cordis.patch.yml`:

```yaml
- id: scoped-http-proxy
  config:
    proxyUrl: http://127.0.0.1:7897
```

SOCKS URLs and embedded proxy credentials are not supported. Optional limits: `maxResponseBytes` (5,000,000), `maxBodyChars` (100,000), `timeoutMs` (30,000), `maxRedirects` (5), and `userAgent` (host default).

Only `198.18.0.0/16`, including IPv4-mapped IPv6 representations, is recognized. This is a deliberate pool selection, not a generic discovery algorithm. Private, loopback, link-local, mixed, empty, or other DNS answers remain blocked. DNS errors, network/TLS failures, and timeouts never activate the fallback. Explicit non-public IP URLs remain blocked.

The plugin applies to all sessions using the default HTTP fetch provider in this profile. It does not intercept model requests, web search, subprocesses, or other fetch providers. Existing host-level proxy configuration remains respected by the stock transport.

## Develop

```sh
git clone https://github.com/314857493/dsh-web-fetch-fakeip.git
cd dsh-web-fetch-fakeip
npm ci --ignore-scripts
npm run check
```

Default tests use local fixtures and require neither external network access nor Clash/API credentials. Optional live check:

```sh
npm run test:live -- https://example.com http://127.0.0.1:7897
```

## Uninstall

```sh
dsh plugin --profile web remove dsh-web-fetch-fakeip
```

Remove any custom `web-fetch-fakeip` profile override and restart DSH. Removing the bundle restores the stock fetch plugin.

## Security and compatibility

The normal path retains the host's public-DNS validation and pinned transport. The host also owns response limits, same-origin redirect policy, and deadlines. Fake-IP fallback delegates DNS to a trusted user-configured proxy; the proxy is responsible for destination access control. See [SECURITY.md](SECURITY.md) for the trust boundary and host dependency audit limitations.
