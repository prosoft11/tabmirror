# Phase 7 — Integrated verification

**Local automated suite passed September 27, 2026; physical-device and cloud acceptance remain outstanding.** Local automated verification is performed with synthetic accounts, isolated Chromium profiles, temporary SQLite databases and separate test ports. Daniel's real Google credentials, browser profile and paired device are not modified.

## Reproduce

Use Node 22.22.3, install dependencies with `npm ci`, and install Playwright Chromium if needed (`npx playwright install chromium`). Run `npm run test:reliability`. This runs typechecking, unit/integration tests, builds, bundled-server checks, extension recovery, authenticated extension-to-web integration and mobile browser verification.

The tests need loopback listeners and browser-launch permission. Integration ports are 4337/4341 (authentication), 4343/4342 (mobile), and 4344 (extension recovery); production-style local development remains on 4317/4319. Temporary browser profiles and databases are deleted after tests. Generated screenshots and timing JSON go into ignored `artifacts/`.

## Evidence and limits

| Area                                    | Evidence                                                                                                                                                                                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contracts, API, auth and state machines | 107 tests pass: strict payload validation, owner isolation, scopes, CSRF/origins, OIDC signatures/PKCE, replay/expiry, atomic revision checks, durable sessions/pairing, storage failures, secret-safe logging, revocation and deletion.                      |
| Native changes → phone view             | September 27 rerun: group creation visible in 8.53 seconds and rename in 7.88 seconds, without manual sync/refresh. Separate Chromium viewer; duplicate URLs and Unicode/long titles verified. Both sampled updates met the local 15-second target.           |
| Native extension                        | Actual Chromium creation, group rename/recolor/move, ungroup/pin, removal, pause/resume, worker termination/restart, API outage, alarm recovery, browser restart and empty snapshot pass against SQLite.                                                      |
| Discarded tabs                          | Capture-boundary test confirms discarded tabs retain their original URL, title and group. Native Chrome discard closed the automated desktop context during testing, so physical Chrome Memory Saver/discard acceptance remains outstanding.                  |
| Recovery timing                         | The actual recovery alarm callback is exercised with an accelerated test alarm. This does not measure physical sleep/wake or guarantee Chrome background scheduling; the normal recovery alarm is two minutes.                                                |
| Pairing feedback                        | Synthetic signed OIDC and an actual extension complete pairing with automatic website confirmation, without manual refresh. Daniel separately reported successful live Google pairing.                                                                        |
| Mobile interactions                     | 390px browser viewport verifies native order, title/URL/group search, collapse restoration, safe links, no referrer/opener, literal HTML-like titles, keyboard focus, freshness, empty/paused/revoked views, failure recovery and rejected unsafe payloads.   |
| Privacy after logout                    | Saved tabs disappear from both the signing-out page and another open page through the session channel. Reload stays signed out and private API requests return 401.                                                                                           |
| Capacity                                | 1,000 tabs / 20 windows / 100 groups: 147,027-byte fixture; about 143 ms from local refresh to display, 55 ms search; approximately 10.1 MB sampled JS heap including test/browser overhead. Single local sample, not a physical phone performance guarantee. |
| Cloud                                   | Not tested: no deployed AWS endpoint, production storage adapter, CDN or public TLS configuration exists yet.                                                                                                                                                 |

Detailed timing for actual native changes is recorded by `scripts/verify-auth.ts` in `artifacts/phase7-timing.json`. Capacity measurements are in `artifacts/phase7-capacity.json`. Screenshots: `phase7-integrated-phone.png`, `phase6-mobile.png`, `phase4-extension.png`.

## Changes made during verification

The previous 30-second website polling interval could not meet the planned 15-second foreground target. Visible authenticated pages now poll every eight seconds; pairing still polls every three seconds. Hidden-page polling remains suspended, returning to the page triggers refresh, and unchanged revisions avoid refetching the snapshot. This increases metadata request volume; the deployment cost assumptions include it.

The supplied logo is included unchanged in the extension and website. Browser tests check that the website logo decodes, and screenshots verify the header and popup layout. The build copies from `apps/extension/tabmirror.png`, which remains the canonical source.

## Checks Daniel/Farris perform after deployment

These require the actual phone, accounts and networks. They are not a reason to discard the automated checks, and they do not require exposing the local development server.

1. Install the production extension build and pair it through the hosted HTTPS website. On the iPhone, disable Wi-Fi, open that website over cellular, and sign in with the approved account. Do not use `127.0.0.1` on the phone; that addresses the phone itself.
2. Create a temporary group with two harmless public pages on the desktop. Rename/recolor it, move a tab out of the group and close one tab. Keep the phone page foreground and compare grouping/order and update delay. Record actual timings rather than assuming the local result applies.
3. Search by title, address and group name; collapse/expand; tap a link. Confirm it opens on the phone and leaves desktop tabs unchanged. Check Safari portrait/landscape, text zoom and the home-screen icon if used. Also discard a harmless desktop tab with Memory Saver or `chrome://discards`; it should remain in the saved list.
4. Put the desktop to sleep or disconnect its network. After more than five minutes, the phone should report an uncertain connection while retaining the last saved tabs. Wake/reconnect, leave Chrome running, and record recovery time. A few minutes is the fallback target; browser scheduling may vary.
5. Pause/resume in the extension. Then sign out on the phone and use Back/reload; private tabs should not remain accessible. Sign back in afterward. If testing revoke/delete, use a disposable test device/profile because those controls intentionally affect its connection/data.
6. Farris signs in using his own approved Google account and pairs his own desktop profile. Confirm each user sees only their own tabs. Attempt a disallowed Google account only if available; synthetic rejection checks already cover this locally.

No one needs to wait a year to finish testing: session expiry/renewal is covered with controlled clocks. Actual long-term browser cookie retention remains an operational limitation, not a tested guarantee. Closed saved Chrome groups are outside the open-tabs contract; check they remain absent until reopened. Physical Safari history-cache behavior, sleep/wake and cellular operation remain release acceptance items.
