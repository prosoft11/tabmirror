# Phase 5 — Authentication, sessions and pairing

Implemented September 23, 2026. **Code and local end-to-end verification are complete. Daniel confirmed local Google client setup, live sign-in and device pairing on September 25, 2026.** Farris sign-in and physical iPhone acceptance remain unverified. [Google setup](phase-5-google-setup.md) is retained as a configuration reference.

## What changed

- Added `openid-client` 6.8.8, pinned with its dependencies. Google discovery is fixed to `https://accounts.google.com`; application configuration cannot substitute an arbitrary issuer. The client checks issuer, audience, expiration, state, nonce and PKCE. `enableNonRepudiationChecks` additionally verifies ID-token signatures against JWKS, as described by the [library](https://github.com/panva/openid-client/blob/main/docs/functions/enableNonRepudiationChecks.md).
- Login attempts last ten minutes, are bound to a random HttpOnly browser cookie and are consumed once. State, nonce and PKCE verifier are independently derived from that cookie secret. SQLite stores only its digest and deadline. The callback cannot choose a return URL and never retains Google access/refresh tokens.
- Verified allowlisted email permits enrollment; immutable Google subject identifies the owner. Email reuse by a different subject cannot take over existing data. Removing an enrolled email from the configured allowlist and restarting disables that owner and revokes its credentials. Re-adding a disabled owner does not silently restore access.
- Opaque 256-bit session tokens are hashed in SQLite. Server-side expiry is checked for every authenticated operation. Sessions renew at most daily for another 365 days, retaining their token during normal renewal; reauthentication rotates the browser's prior session. Logout revokes it immediately.
- HTTPS configuration uses `__Host-tabmirror_session`, `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, no Domain, and a 365-day Max-Age. Explicit HTTP loopback development uses a separate `tabmirror_local_session` cookie without Secure. Local cookies must never be used for hosting. Browser eviction/clearing can still require a new login.
- Website mutations require both exact Origin and a session-bound `X-CSRF-Token`. The CSRF value is derived from the opaque cookie and is exposed only by the authenticated session endpoint. Authenticated website routes reject viewer bearer tokens; device bearer credentials remain upload-only.
- Extension pairing uses a locally persisted 256-bit verifier, a server-stored SHA-256 challenge and an eight-symbol code drawn uniformly from 32 unambiguous symbols. Codes are collision checked. Review and explicit approval bind the owner and reserve the account's single device slot. Redemption checks the verifier, deadline and active account, then creates the upload credential and consumes the grant atomically.
- Wrong verifiers terminate pairing after five attempts. Redemption is no faster than every five seconds. Creation, approval and redemption attempts have durable SQLite rate limits. Expired login/pairing rows and expired rate-limit buckets are pruned during subsequent operations; correctness never depends on pruning.
- Pairing survives popup/worker restarts. A received credential is saved before the extension tries connecting, so a network failure during connection does not require replaying the consumed grant. Secrets are excluded from popup status responses and removed from temporary pairing state after connection. Closed popups are covered by Chrome alarms.
- Device credentials now record issue/use/renewal timestamps and renew at most daily, expiring after the renewal window if inactive. Revocation/deletion and owner disablement still override expiry renewal.
- The account page provides sign-in, code review/approve/deny, device list/refresh/revoke/delete and logout. It clears local account state on logout/401 and guards against stale refresh responses overwriting newer state. It does not persist private application data in localStorage.

## Running modes

| Command                          | Purpose                                                                                            |
| -------------------------------- | -------------------------------------------------------------------------------------------------- |
| `npm run dev:auth`               | Real Google-capable local API on 4319 plus account page on 4317; sign-in disabled until configured |
| `npm run dev`                    | Original synthetic fixture viewer, unchanged as an explicit test mode                              |
| `npm run dev:private`            | Phase 4 manual bearer-credential harness, without browser sessions                                 |
| `npm run dev:collector`          | Legacy in-memory extension harness                                                                 |
| `npm run test:auth`              | Build plus isolated Chromium account/pairing/upload/management test using signed synthetic OIDC    |
| `npm run test:private-extension` | Capture, groups, worker termination, offline/alarm recovery and browser restart regression         |

Run only one API on port 4319 and only one web server on 4317. The authenticated server adds tables/credential timestamps to `.local/private.sqlite` without deleting Phase 4 data. Manually provisioned Phase 4 owners are not automatically assigned to a Google account; doing so would bypass proof of ownership. The old `.local/private-connection.json` is not consumed by the authenticated entry point.

`AUTH_MODE=mock` and `STORAGE_DRIVER=memory` in the foundation `.env` apply only to the old fixture entry point. `dev:auth` always uses Google OIDC and SQLite and has no fake-login switch or unauthenticated provisioning route. It requires explicit allowed emails. The synthetic identity provider lives only in tests and the verification script; it is not included in the application bootstrap.

## New routes

| Route                        | Behavior                                                                                |
| ---------------------------- | --------------------------------------------------------------------------------------- |
| `GET /api/session`           | Signed-out/configuration state, or authenticated email/CSRF token/expiry                |
| `POST /api/auth/login`       | Exact-origin login initiation; returns Google authorization URL                         |
| `GET /api/auth/callback`     | Consumes browser-bound transaction, validates Google response and sets session          |
| `POST /api/auth/logout`      | CSRF-protected session revocation and cookie clearing                                   |
| `POST /api/pairings/start`   | Extension challenge + device name; returns code/ID/deadline and public verification URL |
| `POST /api/pairings/lookup`  | Signed-in, CSRF-protected code lookup for review                                        |
| `POST /api/pairings/approve` | Signed-in, CSRF-protected code + ID approval                                            |
| `POST /api/pairings/deny`    | Signed-in, CSRF-protected denial                                                        |
| `POST /api/pairings/redeem`  | Installation verifier + ID; pending or one-time upload credential                       |

The existing `/api/devices` read/revoke/delete routes use sessions in authenticated mode. The extension's `/api/device/*` protocol remains bearer authenticated. All API responses are no-store and suppress referrers. Operational logs contain only request ID, a fixed operation label, status and duration; callback queries, codes, emails, tokens, snapshots and provider errors are not logged.

Limits: pairing creation 5/IP/10 minutes; review/approve/deny combined 5/session and 20/IP/10 minutes; redemption 12/pairing/minute and 60/IP/minute plus the five-second minimum. IP keys are hashed. General API limits remain local process limits from Phase 4. Behind a future trusted proxy, distributed throttling and source-IP handling must be designed explicitly rather than trusting arbitrary forwarded headers.

## Verification evidence

- `npm run check`: 101 tests pass, TypeScript passes, all bundles build, formatting passes, and bundled entry-point smoke checks pass.
- Signed-token tests reject wrong issuer, audience, expiry, nonce, unverified email, empty subject, invalid signature, wrong state and wrong callback URI.
- Controlled-clock tests cover daily renewal, stable tokens during concurrent requests, 365-day expiry, session rotation/logout, device inactivity expiry, pairing expiry, throttling and wrong-verifier lockout.
- Database restart tests retain sessions, approved grants, consumed-grant protection and rate-limit state.
- Pairing tests cover cross-account isolation, reservation/approval races, explicit replacement, disabled owners, denial/replay, CSRF, bearer-scope bypass and one-time enrollment.
- Actual isolated Chromium passes signed synthetic OIDC + PKCE login, HttpOnly session, code review/approval, popup persistence, automatic extension upload under the signed-in owner, phone-width layout, website revocation, extension rejection, deletion and logout.
- Pairing engine tests cover worker reconstruction, recovery after receiving a credential, lost redemption responses, expiry and cancellation cleanup.
- Bundled auth bootstrap refuses production SQLite mode. Without OAuth configuration it starts safely, keeps sign-in disabled and denies private reads; it does not fall back to mock authentication.
- Synthetic browser evidence: `artifacts/phase5-account.png` (ignored by Git).
- September 24: switched the running local preview from fixtures to `dev:auth`. Agent-browser verified the sign-in page at port 4317, meaningful content, no browser errors or Vite error overlay, and a disabled Google button while credentials are absent. Evidence: `artifacts/phase5-local-signin.png`.

No live Google sign-in, actual iPhone login, elapsed-year persistence, cloud session store, HTTPS deployment, or Google Chrome-profile matching has been demonstrated. The mobile Chrome-profile condition remains the Phase 1 limitation; there is no invented profile-detection mechanism. AWS deployment and its storage/session adapters remain future work.
