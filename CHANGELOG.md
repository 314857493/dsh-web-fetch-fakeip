# Changelog

## 0.3.0

Initial public release under the name `dsh-web-fetch-fakeip`.

- Replace installation-path imports with declared package dependencies.
- Preserve stock HTTP behavior, adding fallback only for recognized Fake-IP DNS.
- Keep proxy transport scoped to the default HTTP web fetch provider.
- Add offline routing and real local proxy transport tests, plus an opt-in live check.
- Add Chinese/English documentation, MIT license, and CI for Node.js 22 and 24.

Earlier local prototypes were named `dsh-web-fetch-proxy` and are not published.
