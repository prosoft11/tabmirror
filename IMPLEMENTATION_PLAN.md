# TabMirror implementation plan

Prepared September 21, 2026. Status: Phases 1–6 implemented; Phase 7 local automated verification passed September 27; Phase 8 hosting and alerts deployed; final DNS and production acceptance pending. Daniel confirmed Google client setup, live sign-in and pairing on September 25; hosted deployment and physical iPhone acceptance remain ahead.

## Outcome and scope

Deliver a private tool that lets Farris open a hosted webpage on his iPhone, away from home, and browse his currently open desktop Chrome tabs organized by computer, window, and native tab group. Preserve his existing organization and make learning links easy to find and open.

Inputs: Asana task 1217017181289043, Daniel's July 31 proposal, Farris's August 3 requirements and August 31 priority update, and Daniel's pasted ChatGPT recommendations. Daniel has now requested implementation, beginning with this phased plan. The project directory was empty when inspected.

### Release requirements

- Private unpacked Manifest V3 extension for desktop Chrome; one Chrome profile and one computer in the initial pilot.
- Only open normal windows, with tab order, group names/colors, and ungrouped tabs. Closed saved groups are excluded.
- HTTPS website accessible outside the desktop's network; Google sign-in restricted to approved accounts.
- Each account sees only its own paired devices and snapshots. Daniel's development account does not automatically receive Farris's data.
- Search titles, URLs, and group names; collapse/expand windows and groups; clearly show device name, tab counts, last successful sync, and stale states.
- Tapping a link opens the original HTTP(S) URL on the phone. Phone interaction does not alter desktop tabs.
- Event-driven uploads with recovery after sleep, network loss, and worker restarts; manual desktop sync and mobile refresh.
- Keep the latest snapshot per device, with explicit deletion and device revocation.
- Target a 365-day application session renewed during use, with logout and revocation support.

### Scope boundaries

No public extension release, subscriptions, shared collections, bookmark management, AI classification, remote desktop controls, content downloading, or browsing-history archive. Multi-computer user interfaces and Chrome-profile identity integration are future work unless technical discovery establishes they are needed for the pilot.

Farris's request for longer login when the browser's Chrome profile matches the account remains a requirement to assess, not silently mark complete. A desktop extension's identity capability does not establish that an iPhone webpage can detect its browser's signed-in Chrome profile. Phase 1 will document feasibility and the proposed sliding-session alternative; any unmet literal requirement will be identified at handover.

## Proposed implementation

Desktop extension → authenticated HTTPS API → private latest-snapshot storage → authenticated mobile website.

- TypeScript throughout, in a small workspace: `apps/extension`, `apps/web`, `apps/api`, `packages/contracts`, `infra`, and `docs`.
- React with Vite for the responsive website; a small TypeScript Manifest V3 extension. Select maintained package versions and lock them during foundation work.
- AWS default: private S3 web assets behind CloudFront, `/api/*` routed to API Gateway and Lambda, DynamoDB for users/sessions/devices/pairing state, and private S3 for snapshot payloads. Infrastructure as code using AWS CDK in TypeScript. Adapt to the company's established AWS environment before provisioning.
- Same-origin website/API cookies, HTTPS, no caching of authenticated API responses at the CDN. Public static assets contain no private data.
- Store snapshots in S3 because DynamoDB has a 400 KB item limit. Use immutable pending objects plus a conditional current-pointer update; promptly remove superseded/failed objects and sweep orphans. This allows retries and rejects stale writes without exposing partial snapshots. Do not enable intentional snapshot history/version retention; document short-lived cleanup overlap and any infrastructure backup retention honestly.
- No third-party favicon service in V1. Use local placeholder icons to avoid extra requests disclosing browsing destinations.
- Google OpenID Connect for identity; server-managed opaque session cookies for the website; separate hashed, revocable, upload-scoped credentials for each extension installation.
- No content scripts, page-content capture, Google browsing-data APIs, or Chrome Sync reverse engineering.

## Phase 1 — Confirm contracts and feasibility

**Work**

- Translate the approved requirements into an acceptance checklist and record assumptions/decisions.
- Define a versioned snapshot contract: device identity, browser-session identity, monotonic revision, capture time, server receipt time, windows, ordered tabs, and group metadata. Retain tab indices so grouped and ungrouped positions can be rendered faithfully.
- Establish deterministic window ordering; do not promise exact desktop stacking order or persistent window labels across browser restarts.
- Verify Chrome permissions and APIs, worker behavior, group moves, browser restart handling, and the profile-matching login request against current documentation.
- Define provisional supported size: 1,000 tabs across 20 windows and 100 groups, within a 2 MiB serialized snapshot. Treat these as test targets, not observed customer usage. Above-limit snapshots must produce a visible error and preserve the prior complete snapshot; never silently truncate.
- Define URL policy: sync HTTP(S) URLs, exclude incognito and internal/local/unsupported schemes before upload. Preserve functional query strings; treat URLs as sensitive data.
- Design a short-lived, single-use device-pairing exchange bound to an installation secret, with explicit signed-in approval, expiry, rate limits, and replay protection.
- Specify session expiry, renewal, logout, revocation, CSRF protection, and account allowlisting. Browser cookie deletion/eviction can still require another login; a literal uninterrupted year cannot be guaranteed.

**Deliverables:** scope/acceptance document, architecture decisions, shared schema draft, privacy and authentication design.

**Exit check:** every requirement maps to a planned implementation/test or an explicitly recorded limitation; local development can proceed without AWS credentials.

## Phase 2 — Project foundation and local environment

**Work**

- Scaffold workspace, builds, TypeScript checks, formatting, targeted test runner, and documented development commands.
- Add shared runtime validation and representative synthetic fixtures, including mixed grouped/ungrouped tabs and large collections.
- Create API/storage interfaces and isolated local adapters; define safe environment configuration and secret exclusions.
- Keep mock authentication confined to explicit local/test configuration; production must refuse to start with authentication bypasses.
- Establish automated build/typecheck/test workflow compatible with the eventual repository host.

**Deliverables:** reproducible local setup, fixture viewer, API skeleton, shared contracts, environment template.

**Exit check:** a fresh checkout builds; website displays a validated fixture through the local API; production configuration fails closed when incomplete.

## Phase 3 — Desktop capture and sync engine

**Work**

- Build the unpacked extension with minimal permissions, restricted API host access, and incognito disabled.
- Read windows/tabs/groups and normalize them into the shared schema; handle missing names and tabs moving during capture.
- Preserve tab order, native group colors, and pinned-tab information. Use browser-session identifiers only within their valid lifetime.
- Listen for relevant tab/window/group changes, debounce bursts, and serialize uploads. Persist revision and pending-work state so worker restarts do not lose updates.
- Use Chrome alarms for periodic recovery/heartbeat; recreate missing alarms on startup. Avoid dependence on long-lived timers.
- Add bounded retries with backoff, request timeouts, and clear oversized-snapshot errors; resnapshot after reconnection rather than replaying an obsolete queue.
- Add extension controls for connect, device name, sync now, pause/resume, disconnect, and last-sync/error status.

**Deliverables:** installable development build and a working local capture/upload path.

**Exit check:** actual Chrome windows match the captured hierarchy; incognito/internal URLs never leave the extension; moves, closures, worker termination, and network recovery are exercised. A valid empty snapshot clears old tabs; capture errors do not.

## Phase 4 — Private API and durable storage

**Completed locally September 23, 2026.** See [implementation and verification](docs/phase-4-private-api.md). SQLite stores snapshots and metadata atomically in one row, so local superseded/orphan objects do not exist. The DynamoDB/S3 adapter and its object cleanup remain required before hosted deployment.

**Work**

- Implement validated snapshot upload, latest-snapshot read, device list/revoke/delete, and health endpoints.
- Derive ownership from authenticated identity/credential; never trust an owner ID supplied in a payload.
- Apply device-scoped authorization, size limits, rate limits, and conditional revision handling. Duplicate retries are safe; delayed uploads cannot replace newer accepted state.
- Store server receipt/last-contact separately from last content change, so an unchanged browser can still report a healthy connection.
- Publish only complete snapshots. Implement superseded-object/orphan cleanup and deletion of device data.
- Log operational metadata without tab titles, URLs, credentials, or snapshot bodies. Return actionable errors without secrets.

**Deliverables:** persistent backend, local-to-cloud adapter boundary, authorization/storage tests.

**Exit check:** upload/read/replace/delete works; unauthorized access and cross-account reads/writes fail; expired/revoked credentials fail; stale and oversized writes retain the previous valid state.

## Phase 5 — Google login and extension pairing

**Implemented locally September 23, 2026; Daniel confirmed live Google setup and pairing September 25.** See [authentication verification](docs/phase-5-authentication.md) and [Google client setup](docs/phase-5-google-setup.md). Both approved emails are configured. Signed synthetic OIDC and real Chromium pairing are tested. Daniel reports successful live Google sign-in and pairing; Farris sign-in and physical iPhone acceptance remain unverified.

**Work**

- Configure Google web OAuth client, exact callback URLs, and approved pilot accounts when those inputs are available.
- Use maintained OIDC components to validate issuer, audience, expiry, state, nonce, and verified identity. Identify accounts by Google subject, using verified email for enrollment allowlisting.
- Issue opaque Secure/HttpOnly cookies with appropriate SameSite protection; hash server-side session tokens; enforce server expiry on every request rather than relying on eventual database TTL cleanup.
- Implement a 365-day session policy with controlled renewal and session rotation. Test concurrent requests, logout, and revocation; document browser persistence limitations.
- Complete pairing: extension starts challenge → signed-in user confirms the displayed device/code → extension redeems once using its installation secret → server issues upload-scoped token.
- Store extension credentials locally, never in synchronized Chrome storage, URLs, or source code. Implement replacement/revocation and protect settings mutations against CSRF.

**Deliverables:** approved-account sign-in, durable sessions, end-to-end pairing and device management.

**Exit check:** paired extension uploads under the right owner; disallowed Google accounts and replayed/expired pairing codes fail; session expiry/renewal works with a controlled test clock. Actual iPhone sign-in is tested before release; elapsed-year behavior is not falsely claimed as observed.

## Phase 6 — Mobile browsing experience

**Implemented and locally verified September 25, 2026.** See [features and verification](docs/phase-6-mobile.md).

**Work**

- Build a clean phone-first view of computer → windows → groups → tabs, with accessible touch targets and keyboard operation.
- Implement search that keeps matching tabs in their hierarchy and reveals matches inside collapsed groups; display result counts and a clear reset.
- Preserve native tab ordering using ordered group and ungrouped runs; group metadata remains distinct from user expansion preferences on the phone.
- Show initial loading, no paired device, first-sync pending, empty snapshot, error, paused/last-known state, and stale snapshot messages.
- Show exact update time plus relative age. Treat loss of contact as unknown/stale, not proof that the desktop is powered off.
- Refresh when the page becomes visible and poll moderately while visible. Explain that refresh retrieves the latest upload and cannot wake a sleeping Mac.
- Open only validated HTTP(S) links safely; prevent tab titles from rendering as HTML, suppress referrer leakage, and avoid caching private responses.

**Deliverables:** usable responsive private website integrated with the authenticated backend.

**Exit check:** phone-width flows work with realistic and large fixtures; search/collapse/open-link behavior works; signed-out users cannot access cached private data; basic accessibility checks pass.

## Phase 7 — Integrated reliability and security verification

See [local evidence and physical-device checklist](docs/phase-7-verification.md). Physical iPhone/cellular acceptance follows deployment.

**Work**

- Exercise real desktop Chrome → authenticated API/storage → phone browser flows.
- Cover create/close/rename/recolor/move groups, grouped-to-ungrouped moves, duplicate URLs, long/Unicode titles, pinned tabs, discarded tabs, browser restart, and closed saved groups.
- Cover sleep/wake, offline/reconnect, worker suspension, API failures, delayed requests, malformed data, device revocation, session expiry, and account isolation.
- Verify freshness when no tabs change and honest stale display when no heartbeat arrives.
- Benchmark the provisional 1,000-tab fixture and measure payload size, upload frequency, memory, and phone rendering. Tune only where evidence shows a problem.
- Inspect permissions, secrets, logs, CORS, cookies, CSRF, injection protection, link protocols, and API/CDN cache behavior.

**Deliverables:** reproducible test results, acceptance checklist with evidence, fixed release blockers.

**Exit check:** all core acceptance checks pass. Target normal healthy desktop changes becoming visible within 15 seconds with a foreground phone page; fallback recovery within a few minutes of Chrome resuming. Record measured results and any deviation rather than guarantee background timing.

## Phase 8 — AWS deployment and production verification

**Preparation only; not deployed.** [Deployment design and prerequisites](docs/phase-8-deployment.md) document missing cloud adapters and confirmed account/domain/budget inputs. The default profile identity check passed for account `400745793130` on October 2; no resources have been created.

**Work**

- Inspect authorized AWS conventions and select account/region, existing resources, and deployment role; prepare an infrastructure change summary before applying it.
- Obtain Farris's domain choice through Daniel, configure DNS/TLS, and finalize Google production callback URLs.
- Provision private storage, least-privilege roles, secrets, API, static hosting, logs with bounded retention, and cleanup scheduling. Prepare expected cost based on actual region and pilot usage before deployment.
- Make authenticated API responses uncacheable at every layer; validate HTTPS, redirects, and access controls through the public endpoint.
- Produce versioned web/API/extension builds; retain rollback instructions and previous application artifacts without retaining browsing snapshots as release artifacts.
- Verify the real phone on cellular or another network while the desktop remains on its own network. Confirm no local tunnel or desktop web server is needed.

**Deliverables:** private production URL, AWS configuration, deploy/rollback runbook, extension release package, production smoke-test results.

**Exit check:** approved account signs in on iPhone, pairs the desktop, and sees its correctly grouped tabs remotely; unauthorized account is denied; monitoring and rollback procedures are usable.

## Phase 9 — Farris pilot and handover

**Work**

- Provide short installation, pairing, everyday-use, troubleshooting, update, disconnect, and delete-data instructions.
- Have Daniel/Farris validate representative real tab collections and normal learning workflows, including opening links away from home.
- Record pilot feedback about usefulness, freshness, search, and login friction; fix launch-blocking issues before adding features.
- Deliver an operational ownership list for AWS, DNS, Google OAuth, secrets, and releases, plus known limitations and maintenance tasks.
- Prepare an Asana completion summary with verification evidence for Daniel to review/post. Posting messages or changing Asana status is a separate explicitly requested action.

**Deliverables:** working private tool, tested release, user guide, runbook, final acceptance record, prioritized future backlog.

**Exit check:** Daniel confirms the delivered behavior matches the agreed acceptance checklist and Farris can use the tool independently. Record the Chrome-profile session request as resolved, accepted alternative, or outstanding; do not hide it under a completed status.

## Dependencies and sequence

Implement phases 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9. Each phase ends with working artifacts and its exit-check evidence. Some cloud configuration can be prepared earlier without provisioning. If credentials/domain are unavailable, continue local implementation and fixture-based verification, clearly separating simulated checks from live ones.

Inputs needed before live authentication/deployment:

1. Approved Google emails for Farris and Daniel, and the Google Cloud project/OAuth configuration owner.
2. Authorized AWS account/region and deployment access; existing hosting conventions and budget constraints.
3. Farris's selected domain/subdomain and DNS access.
4. Access to a representative desktop Chrome profile and an actual iPhone for final user testing.

Do not paste secrets into chat or commit them. Use the local environment and approved secret store. None of these inputs blocks contracts, scaffolding, capture logic, or the fixture-based UI.

## Planning allowance

Provisional engineering effort, to recalibrate after Phase 3: phases 1–2, 4–6 hours; phase 3, 5–8 hours; phases 4–5, 9–15 hours; phase 6, 5–8 hours; phase 7, 5–8 hours; phases 8–9, 5–9 hours. Total: roughly 33–54 focused hours, excluding waiting for credentials, DNS, and user pilot feedback. These are planning allowances, not a delivery promise. A demonstrable local prototype should arrive before cloud deployment; production readiness depends on the full acceptance checks.

## Progress record

| Phase                         | State            | Evidence                                                                                                                                   |
| ----------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Planning                      | Complete         | This plan; task description and three comments reviewed; pasted recommendations reviewed                                                   |
| 1. Contracts and feasibility  | Complete         | [Deliverables](docs/phase-1/README.md), [verification](docs/phase-1/verification.md), snapshot schema and examples                         |
| 2. Foundation                 | Complete         | [Local setup](README.md), [verification](docs/phase-2-verification.md), shared validator, fixtures, local API/viewer, CI                   |
| 3. Extension                  | Complete         | [Setup and scope](docs/phase-3-extension.md), [verification](docs/phase-3-verification.md), capture/sync engine and popup, local collector |
| 4. API and storage            | Local complete   | [SQLite/API verification](docs/phase-4-private-api.md); cloud adapter remains Phase 8                                                      |
| 5. Authentication and pairing | Local complete   | [Authentication](docs/phase-5-authentication.md); Daniel confirmed live Google pairing                                                     |
| 6. Mobile website             | Local complete   | [Mobile verification](docs/phase-6-mobile.md)                                                                                              |
| 7. Integrated verification    | Local checks     | [Evidence and remaining device checks](docs/phase-7-verification.md)                                                                       |
| 8. Production deployment      | Hosting deployed | [Deployment preparation](docs/phase-8-deployment.md); hosting smoke passed; DNS/email confirmation and acceptance pending                  |
| 9. Pilot and handover         | Pending          | —                                                                                                                                          |

## Technical references checked during planning

- Chrome native group metadata and session-scoped IDs: https://developer.chrome.com/docs/extensions/reference/api/tabGroups
- Manifest V3 service worker lifecycle and alarms: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
- Chrome identity API scope: https://developer.chrome.com/docs/extensions/reference/api/identity
- Google OpenID Connect: https://developers.google.com/identity/openid-connect/openid-connect
- Chrome cookie lifetime cap: https://developer.chrome.com/blog/cookie-max-age-expires (400 days; this does not guarantee persistence on iPhone browsers).
- DynamoDB item limit: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Constraints.html (400 KB).
