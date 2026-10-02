# Privacy, authentication, and device enrollment

Status: design baseline. Phase 5 implements and locally tests OIDC validation, sessions and pairing; see [implementation evidence](../phase-5-authentication.md). Live Google configuration and hosted verification are still pending.

## Data and trust

Tab URLs can contain sensitive paths, queries, and fragments. Capture only eligible committed URLs and titles, grouping metadata, and aggregate omitted count. Do not strip arbitrary query parameters because that breaks functional learning links. Reject username/password URL components and all non-HTTP(S) schemes. Internal HTTP(S) links may be included but never fetched by the backend; this prevents server-side request forgery by construction. Treat every title/group name/device name as untrusted text. The website parses URLs again and never renders raw HTML. External links use `noopener noreferrer`; no external favicon service, preview fetch, analytics, or service-worker caching of private data.

Extension credentials live in `chrome.storage.local` with access restricted to trusted extension contexts. No `storage.sync`, no page injection, no credentials in links/query strings/logs. A user/device compromise can expose local credentials; revocation is the recovery mechanism. Server stores hashes of high-entropy bearer/session tokens, not their raw values. All transfer uses HTTPS except explicit loopback development.

## Google identity and web session

Use a maintained OpenID Connect client with authorization code flow and PKCE S256. Only `openid email` scopes are needed. Bind a 10-minute login transaction to the initiating browser with random state/nonce and a short-lived HttpOnly cookie; verify callback state, code/verifier, signature/JWKS, issuer, audience, expiry and nonce before session creation. Never accept an ID token merely decoded by the client. No open redirect; no Google API access/refresh tokens retained for ongoing browsing access.

Enrollment requires a configured allowlisted verified email, then binds the Google `sub` as immutable owner identity. Subsequent sessions require the bound subject to remain enabled; do not reassign an existing owner's data based on changed email. Administrators removing access disable the subject and revoke its sessions/devices. Every request checks active user/device state. Daniel's account cannot impersonate Farris.

Session token: 32 cryptographically random bytes, opaque, hashed server-side. Cookie `__Host-tabmirror_session`, Secure, HttpOnly, SameSite=Lax, Path=/, no Domain. Initial server expiry and Max-Age: 365 days. Renew expiry at most daily during authenticated use so active users can remain logged in beyond one year without Google token renewal. Keep the opaque token stable during normal renewal to avoid concurrent-response rotation races; rotate at sign-in/re-authentication or explicit security reset. Session reuse across Google login is forbidden. Logout revokes the server record and clears cookie; scheduled TTL is cleanup only. A revoke-all operation may be added when session-management UI is built, but disabled users must invalidate all sessions immediately.

Mutating web endpoints require a per-session CSRF token in a custom header plus exact Origin validation. OIDC callback relies on state/nonce, not the application CSRF header. SameSite and CORS are defense in depth, not substitutes for authorization. No state changes via GET besides consuming the authenticated OIDC callback transaction.

Long-lived session theft is a tradeoff of the requested convenience: revocation, HTTPS, HttpOnly, script restrictions, no token logging, and no third-party scripts are required. No promise of a literal uninterrupted year: browsers/users may clear cookies. Chrome caps cookie lifetime at 400 days, which accommodates the requested target in Chrome but proves nothing about iPhone persistence. Profile-match-dependent extension of the session remains an explicit open acceptance item; do not invent a phone profile signal.

## Pairing state machine

1. Extension generates 32-byte random verifier, persists it locally until pairing finishes, sends only SHA-256 verifier challenge with display name to `POST /pairings`.
2. Server returns random opaque pairing ID and an 8-character human code from a 32-character unambiguous alphabet (40 bits), collision checked. Expiry 10 minutes. Neither is a device credential. Verification page URL contains no verifier or bearer token; user types code on the site.
3. User signs in, enters code, compares the device name/code with the extension, and explicitly confirms. Approval atomically records the authenticated owner only for pending/unexpired code. Name is a user label, not hardware attestation. Denial/expiry are terminal.
4. Extension polls redeem no faster than every 5 seconds with pairing ID and verifier in JSON over HTTPS. Server checks hash, expiry, approved state and owner still active; pending returns pending. Successful redemption transaction creates device, stores credential hash, and consumes pairing record once.
5. Successful response returns newly generated 32-byte bearer token once. Lost redemption response requires a fresh pairing, not replaying a consumed grant. Revoke any abandoned enrolled device from the website. Initial pilot enforces at most one active device per account: replacement requires explicit revoke/delete before approval, never automatic displacement.
6. Extension deletes pairing verifier and stores credential locally. Device bearer can upload/check its revision/report status/revoke itself; it cannot read snapshots or manage other devices. Scope and ownership are server enforced, independent of CORS.

Initial tunable limits: pairing creation 5 per IP per 10 minutes; approval attempts 5 per session and 20 per IP per 10 minutes; redeem 12 per pairing per minute and 60 per IP per minute; 5 incorrect verifier attempts terminate pairing. General unauthenticated IP throttling protects unknown pairing IDs. Uploads 30 per device per minute plus 2 MiB body limit. Return Retry-After on throttle. Add cost-level API throttles when deploying; avoid storing raw IPs in long-lived application logs.

Device credentials expire after 365 days of inactivity, renewing at most daily on authenticated use, until revoked; issue time/activity/expiry tracked server-side. Credential replacement uses re-pairing. API publishes only if credential/device/user remain active in the final publication transaction, so an upload racing revocation cannot revive the device.

## Retention and deletion

Latest snapshot remains until user deletes its device; no intentional browsing history. Superseded/pending objects can overlap briefly during writes and cleanup; target deletion within 24 hours. No snapshot versioning, replication, payload backups, request-body logging, or private browser caches. Device deletion hides data immediately and revokes writes before asynchronous purge. Metadata tombstones may retain opaque ID and deletion time to prevent resurrection, without URLs/titles or active credentials. Operational logs retain request IDs, error codes, latency and counts for 14 days, not request bodies, auth headers, OIDC callback queries, human pairing codes, or link content. Audit deployed access-log/CDN configuration as well as application logging.

## Required negative tests

Cross-account reads/writes/revokes; forged owner fields; credential scope misuse; expired/disabled account; invalid OIDC issuer/audience/state/nonce/signature; pairing brute force/replay/expiry/approval race; CSRF/cross-origin mutations; javascript/data/file URLs and URL credentials; HTML in titles; oversized payloads; late upload after revoke/delete; pointer replacement/cleanup/read races; sensitive-data absence from logs and caches. Acceptance matrix R03/R05/R06/R13–R17 covers release evidence.

References: [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect), [Chrome cookie cap](https://developer.chrome.com/blog/cookie-max-age-expires), [Chrome identity](https://developer.chrome.com/docs/extensions/reference/api/identity). Settings above are application design choices, not guarantees made by those providers.
