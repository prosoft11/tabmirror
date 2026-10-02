# TabMirror

Private desktop Chrome tabs, organized by window and native tab group, accessible from a phone. **Phase 6 implements the responsive private tab browser**, with search, collapse/expand, safe link opening, freshness indicators, and automatic pairing progress. Daniel confirmed live Google sign-in and device pairing on September 25, 2026. See [mobile browser verification](docs/phase-6-mobile.md), [Google setup](docs/phase-5-google-setup.md), and [authentication verification](docs/phase-5-authentication.md). Cloud deployment and physical iPhone acceptance remain future work.

## Run locally

Use the pinned Node.js 22 runtime (the system Node 18 is too old). With nvm installed:

```sh
nvm install
nvm use
npm ci
cp .env.example .env
npm run dev:auth
```

Open [the local preview](http://127.0.0.1:4317) in Chrome. The authenticated API runs at `http://127.0.0.1:4319`. The sign-in button stays disabled until the Google client is configured. Use `127.0.0.1`, not `localhost`, because the local API checks the host. Both ports bind only to loopback. Ctrl+C stops both servers. Port conflicts fail rather than selecting another port; edit both ports in `.env` if needed.

For the original synthetic fixture viewer, stop the authenticated server and run `npm run dev` (API 4318). Choose Everyday, Empty, or Large collection to load a snapshot through the API and shared validator. The large fixture contains 1,000 tabs, 100 groups and 20 windows. Expand windows and open synthetic links. Refresh reloads the fixture; it does not sync Chrome. Fixture timestamps are fixed example data, not a live freshness indicator.

## Reliability and branding

Phase 7 automated checks run with `npm run test:reliability`; see [results and remaining device acceptance](docs/phase-7-verification.md). Tests use temporary databases and browser profiles on separate ports, preserving your current pairing. [AWS deployment preparation](docs/phase-8-deployment.md) records the implemented production candidate and remaining live deployment steps.

The canonical logo is `apps/extension/tabmirror.png`. Builds copy it unchanged into the extension and website. It appears in the extension toolbar/popup, private website header, favicon and Apple touch icon. Reload the unpacked extension at `chrome://extensions` to see the new toolbar icon; this does not require re-pairing. Refresh the website to load the new header.

## Commands

| Command                          | Purpose                                                                                |
| -------------------------------- | -------------------------------------------------------------------------------------- |
| `npm run dev:auth`               | Start the Google-capable local API and account/pairing page                            |
| `npm run test:reliability`       | Full local checks plus extension recovery, authenticated integration and mobile checks |
| `npm run test:auth`              | Verify signed synthetic OIDC, Chrome pairing, upload and device management             |
| `npm run dev`                    | Generate contracts; start local API and web viewer using `.env`                        |
| `npm run dev:private`            | Start the durable private API on port 4319                                             |
| `npm run test:private-extension` | Verify the actual extension against durable storage                                    |
| `npm run dev:collector`          | Start the separate extension collector on port 4319                                    |
| `npm run test:extension`         | Build and test the actual extension in an isolated Chromium profile                    |
| `npm run generate`               | Generate TypeScript types and browser-safe standalone validator from the JSON schema   |
| `npm run typecheck`              | Regenerate contracts and check all TypeScript                                          |
| `npm test`                       | Contract, local HTTP API, configuration and adapter tests; requires loopback binding   |
| `npm run build`                  | Generate contracts and bundle fixture/private APIs, web app and Chrome extension       |
| `npm run format`                 | Format source and documentation                                                        |
| `npm run test:built`             | Smoke-test the bundled API and production startup refusal                              |
| `npm run check`                  | Typecheck, tests, all builds, bundled API smoke test and formatting check              |

**For the hosted site:** follow [production extension installation](docs/production-extension.md). Use `artifacts/production/extension` with `tabs.portuit.com`; local extension codes will not work there.

Local build outputs are `apps/api/dist`, `apps/web/dist`, and `apps/extension/dist`. Load the extension build in a dedicated Chrome profile and connect it to the durable private API using its `deviceToken` ([Phase 4 setup](docs/phase-4-private-api.md)). The bundled API can run with `node --env-file=.env apps/api/dist/main.js` while the development server is stopped. It deliberately refuses production mode until production auth/storage adapters exist.

## Workspace

- `packages/contracts`: source JSON schema, generated types/standalone structural validator, strict JSON parsing, cross-field validation, synthetic fixtures.
- `apps/api`: durable private SQLite API with separate viewer/device credentials; fixture API and in-memory collector retained as test harnesses. Cloud adapter/deployment remain future work.
- `apps/web`: responsive private tab browser, account/pairing/device management and explicit fixture viewer; requests `/api` through the same-origin dev proxy.
- `apps/extension`: Manifest V3 capture, sync/recovery, durable code pairing and popup controls.
- `infra`: deployment boundary notes; no cloud resources created.
- `tests`: invalid-data, host/origin restrictions, config failure, ownership and fixture HTTP checks.
- `.github/workflows/check.yml`: ready for GitHub CI; no remote repository or hosted run is assumed.

## Configuration and safety

Copy `.env.example` for explicit `development/local/mock/memory` settings. Missing settings, production mode, external bind addresses and nonlocal adapters cause API startup failure. The mock adapter identifies only synthetic local data and reports `authenticated: false`; it is not a real login. The fixture API is read-only, sends `no-store`, rejects remote Host/Origin headers and has no CORS allowance. Memory data resets with the process. Do not put real tab data in fixtures.

The durable private API stores data in `.local/private.sqlite` and separate viewer/device secrets in `.local/private-connection.json`; these survive restarts. See the Phase 4 guide for access, deletion and local authentication limitations.

The Google client secret belongs only in `.env` on the API server. The authenticated entry point has no mock-login fallback.

The fixture preview needs no secrets. The legacy extension collector generates a local token in `.local/extension-connection.json`; keep it private. `.env*` (except the template), build output, local data and browser evidence are ignored. Future OAuth/AWS secrets belong only in approved environment/secret storage, never `VITE_*` client variables or Git. Generated validators are recreated before every build/test/typecheck and do not compile schemas with `eval` in browsers/extensions.

See [the implementation plan](IMPLEMENTATION_PLAN.md), [Phase 1 contracts](docs/phase-1/README.md), and [Phase 2 verification](docs/phase-2-verification.md).

Chrome Web Store private-release materials and dashboard steps are in [the submission guide](docs/chrome-web-store/submission-guide.md).
