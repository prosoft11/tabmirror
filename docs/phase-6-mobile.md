# Phase 6 — Mobile tab browser

Implemented and locally verified September 25, 2026. Daniel separately confirmed successful live Google sign-in and device pairing. His existing credentials, database and paired device were not modified by verification.

## Experience

- Your tabs shows computer → windows → native groups and ordered ungrouped runs, preserving Chrome tab order and group colors. Pinned and untitled tabs are handled.
- Search matches titles, URLs and group names, reveals matching collapsed sections, shows result counts, and restores expansion preferences when cleared. Expand/collapse all and individual controls affect only the website.
- HTTP(S) links open in a new tab with no opener or referrer. Titles render as text; no remote favicon requests are made. Incoming snapshots are validated again before rendering.
- Initial loading, no device, first sync, empty snapshot, no results, errors, paused and revoked connections have distinct views. Failed refreshes retain the last valid snapshot with an error and retry control.
- Freshness uses verification time, not just content-change time. After five minutes without verification, the connection is uncertain; this does not assert that the computer is off. Sync details show exact and relative timestamps.
- Visible pages poll device metadata every eight seconds (tightened during Phase 7 to meet the foreground update target) and refresh on return. Snapshot fetches follow revision changes; manual refresh reloads the snapshot. Failed snapshot requests retry every 30 seconds while visible.
- Private snapshot state stays in memory. Logout clears it, broadcasts logout to other tabs, and invalidates server access. Page-hide removes private content before history restoration; returning refreshes authentication.

## Pairing feedback fix

Approval now displays a spinner and connecting/first-sync messages. Device metadata polls every three seconds during pairing, then displays a completion message and a View tabs action automatically. Expiry shows a recovery action. The extension popup also shows progress for pairing, syncing, renaming and disconnecting. Reload the unpacked extension to pick up its updated popup build.

## Verification

- `npm run check`: 106 tests, TypeScript, build, built-server durability/security checks and formatting passed.
- `node --import tsx scripts/verify-auth.ts`: isolated signed synthetic OIDC, actual Chromium extension pairing/upload, and automatic website completion without manual refresh passed.
- `node --import tsx scripts/verify-mobile.ts`: 390px phone viewport, native ordering, collapsed search restoration, safe link opening, keyboard focus, freshness clock, paused/empty/revoked states, 1,000 tabs, failed-storage recovery, unsafe payload rejection and logout privacy passed.
- Visual evidence: `artifacts/phase6-mobile.png` (synthetic data, including a literal HTML-like title used to check injection safety). No horizontal overflow or browser runtime errors observed.

Browser tests use temporary SQLite databases and separate ports (4337/4341 and 4343/4342). They do not change the real development account or paired device on 4317/4319.

Physical iPhone/Safari acceptance, Farris live sign-in, cloud deployment, and broader integrated reliability verification remain for subsequent phases. Phone-width Chromium verification does not establish actual iPhone compatibility.
