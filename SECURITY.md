# Security

## Trust boundary

This plugin is intended for a user's trusted HTTP proxy. It does not disable
DSH's public-address checks globally. It preserves the stock fetch path and
permits a proxy fallback only for a fully recognized Fake-IP answer set after
WEB_BLOCKED_URL. Non-public IP literals and local hostnames remain blocked.

An IP in the configured Fake-IP pool is not proof that its hostname is safe.
On the fallback path the proxy resolves the hostname and owns destination
access control. Do not use an untrusted proxy or a proxy without appropriate
network restrictions when processing untrusted URLs. This mirrors DSH's
explicit HTTP proxy trust boundary; it is not a general SSRF prevention service.

No fallback occurs for arbitrary private addresses, mixed DNS answers,
network failures, TLS failures, or timeouts. Proxy errors do not retry directly.

## Dependencies

The separate dsh-scoped-http-proxy service owns the Undici proxy transport. Compatibility is
currently pinned to DSH web component peers at 0.2.1-rc.4. Those host packages
have their own dependencies: the initial npm audit reported advisories in
older host-owned Undici and Zod versions. Updating that service does not patch the host's dependency tree. The repository does not
apply overrides to a user's DSH installation. Review `npm audit` and upgrade
host components when a compatible upstream release is available.

## Reporting

Use GitHub private vulnerability reporting if enabled. Otherwise contact the
maintainer through their GitHub profile before sharing sensitive details.
Do not include credentials, session logs, or proxy authentication data in issues.
