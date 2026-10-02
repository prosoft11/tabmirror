# Phase 3 verification record

Implemented September 22, 2026. Scope: actual unpacked MV3 extension with a loopback-only integration collector, not a hosted product.

## Automated evidence

- 65 unit/HTTP tests pass across the existing foundation and the new capture, engine, transport and collector tests.
- New cases cover private/internal/credentialed URL filtering, changing browser structure, ambiguous focus, empty captures, serialized writes, worker-state reconstruction, lost acknowledgements, offline retries, Retry-After, revoked credentials, pause/resume, capture-failure preservation, replacement-token failure, local disconnect on revocation failure, and redirect refusal.
- Collector tests verify bearer authentication, cross-origin denial, exact retry idempotency, stale/conflicting revision rejection, invalid-payload preservation, heartbeat revision checks, empty replacement, and token revocation.
- Types, bundles, built fixture API smoke test and formatting are included in `npm run check`. The browser verification script is included in TypeScript checks.

## Actual Chromium evidence

`npm run test:extension` launches the built extension in a temporary persistent Chromium profile. It uses synthetic tabs and a separate ephemeral collector; it does not inspect personal Chrome tabs.

Verified through Chrome APIs and the actual extension runtime:

1. Connect through popup with a local token; capture currently open tabs and native groups automatically.
2. Filter unsupported URLs; preserve tab IDs/order and group names/colors.
3. Rename/recolor groups, move a group to another window, ungroup/pin a tab, and remove a tab; observe changed snapshots.
4. Rename device, pause while tabs change, then resume; paused content is not uploaded.
5. Stop the actual MV3 worker using CDP and wake it again; connection and browser-session identity survive.
6. Stop the collector, observe a sync error, restart it and trigger the real recovery alarm callback; latest browser state uploads and the error clears. Only alarm timing is accelerated for the test.
7. Close/reopen the browser using the same isolated profile; credentials persist, browser-session identity changes, and revision increases.
8. Remove eligible tabs; an empty snapshot clears previous data.
9. Disconnect; local state loses its credential and collector rejects the revoked token.

The popup screenshot at `artifacts/phase3-extension.png` is ignored by Git and was visually reviewed. Inspection found a hidden-field CSS issue and it was corrected. The browser test also revealed ambiguous native focus flags; capture now records those as unknown instead of rejecting valid tab contents.

## Limits and follow-up

- Physical Mac sleep/wake, real iPhone access and long-term daily-use performance are not claimed as tested. Worker restart, browser restart and alarm/network recovery are covered independently.
- Incognito exclusion is enforced by manifest plus capture filtering tests; this run did not open the user's incognito windows.
- The collector retains only one in-memory snapshot and has a per-run revocable local token. It is not the production authorization/storage implementation. Restart discards its data and normally rotates the token.
- Google sign-in, production pairing, remote hosting, persistent snapshot storage and the website's live-device view remain later phases.
- The GitHub workflow now includes the Chromium extension test, but no hosted CI run has been observed.

Phase 3 exit criteria are satisfied for the local prototype. See [setup](phase-3-extension.md) before loading it into a Chrome profile.
