# Phase 1: scope and acceptance contract

Status: specification complete, 2026-09-21. These are implementation acceptance criteria, not claims that the application already passes them. Source: [Asana task](https://app.asana.com/1/605136897823947/project/728769000730854/task/1217017181289043), its three comments, and Daniel's supplied recommendations.

## Product boundary

Farris opens the private website on his iPhone outside his home network, signs in with an approved Google account, and opens learning links organized like his desktop Chrome. The initial pilot supports one paired Chrome profile on one Mac per account. Daniel uses a separate account and synthetic data. Account ownership never implies sharing.

Only normal, non-incognito Chrome windows are eligible. Only currently open HTTP(S) tabs are uploaded. Discarded tabs are still open and eligible. Closed saved groups, browser history, bookmarks, page content, cookies, and incognito data are excluded. Tabs with unsupported schemes, missing committed URLs, or URL credentials are omitted before upload. Windows and groups with no eligible tabs are omitted. Show the aggregate omitted-tab count without revealing omitted titles/URLs; do not count incognito windows or tabs at all.

Preserve eligible tab strip order, including ungrouped runs between groups. Window order is ascending numeric window ID, stable within a browser session, not desktop stacking order. Labels are Window 1, Window 2, etc. Group names/colors are native; blank titles get a display-only fallback. Phone collapse preferences never change desktop groups. Computer name is user supplied during pairing, not extracted from OS identity.

## Requirement-to-test matrix

| ID  | Requirement and acceptance evidence                                                                                                                                                                                               | Implementation / verification       |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| R01 | Unpacked MV3 extension installs on desktop Chrome and reads only its profile; no store publication required.                                                                                                                      | 3 / 7                               |
| R02 | Mixed groups and ungrouped runs match eligible desktop order after tab/group creation, moves, deletion, recoloring, and renaming.                                                                                                 | 3, 6 / 7                            |
| R03 | Incognito, unsupported URLs, URL credentials, closed saved groups, and page contents do not appear in captured payloads or logs.                                                                                                  | 3, 4 / 7                            |
| R04 | Website loads over HTTPS on iPhone cellular with no desktop-local server or tunnel.                                                                                                                                               | 8 / 8, 9                            |
| R05 | Approved Google account signs in; unapproved and unverified identities fail; account A cannot read/write/revoke account B's resources.                                                                                            | 4, 5 / 7                            |
| R06 | Valid server session lasts 365 days and renews during use; logout/revocation takes effect immediately for new requests. Controlled-clock tests cover expiry. Browser retention remains a limitation.                              | 5 / 7, 9                            |
| R07 | Chrome-profile-dependent extended login: no verified iPhone web mechanism; sliding session alternative proposed, stakeholder resolution outstanding.                                                                              | feasibility complete / 9 resolution |
| R08 | Search title, URL, and group name with Unicode case-insensitive substring matching; reveal matching children; clear restores previous collapse choices. Window/group toggles work by touch and keyboard.                          | 6 / 7                               |
| R09 | Tapping a validated link opens it on the phone without desktop mutation or transmitting application referrer data. Original functional URL preserved.                                                                             | 6 / 7                               |
| R10 | Event bursts coalesce; ordinary changes appear within target 15 seconds on a visible phone page under healthy conditions. Alarms recover after worker termination/restart and sleep; measure actual timings.                      | 3, 6 / 7                            |
| R11 | Show last successful capture/receipt and last contact distinctly. No contact for >5 minutes is stale, not proven offline. Read failures never erase the last display or imply fresh data.                                         | 3, 4, 6 / 7                         |
| R12 | Sync now captures on desktop; phone refresh fetches cloud state and cannot wake a Mac. Pause retains last snapshot with explicit last-known paused status.                                                                        | 3, 6 / 7                            |
| R13 | One current complete snapshot per device; duplicates are idempotent and older revisions rejected. Empty successful capture clears old tabs, failed capture does not.                                                              | 3, 4 / 7                            |
| R14 | Pairing needs signed-in confirmation and installation proof; expiry/replay/rate-limit tests pass. Device credential cannot read snapshots.                                                                                        | 4, 5 / 7                            |
| R15 | Revoke blocks uploads immediately but retains last snapshot; delete hides data immediately and schedules physical deletion within 24 hours. Disconnect removes local credentials and reports whether server revocation succeeded. | 3, 4, 5 / 7                         |
| R16 | Up to 1,000 eligible tabs, 20 eligible windows, 100 represented groups, and 2 MiB UTF-8 JSON are supported test targets. Oversize is explicit, with no truncation or replacement of last valid snapshot.                          | 2–4, 6 / 7                          |
| R17 | No third-party favicon/analytics calls; no tab bodies/URLs/titles/tokens in application or API access logs; private responses bypass all caches.                                                                                  | 4–6, 8 / 7, 8                       |
| R18 | Farris selects production domain; AWS deployment, rollback, installation, deletion, and maintenance instructions are supplied.                                                                                                    | 8, 9 / 9                            |
| R19 | Empty, pending first sync, signed out, expired auth, stale, revoked, paused, loading, and retryable errors have usable UI states.                                                                                                 | 6 / 7                               |

## Open inputs and limitations

- Daniel supplies approved account emails and authorized AWS/Google Cloud access when needed; Farris selects the domain. No secrets in chat or Git. These block live setup, not local work.
- Actual iPhone Safari and Chrome plus current stable Mac Chrome must be tested. Architectural minimum Chrome 120; alarm persistence is checked/recreated instead of relying on newer flags.
- One-year browser retention cannot be guaranteed after cookie deletion, browser policy, private browsing, or account revocation. R07 needs explicit stakeholder resolution before claiming full requirement completion.
- HTTP(S) internal-network destinations are mirrored but may not be reachable remotely. Website login at a destination is independent of TabMirror login. No content or authenticated webpage session transfers to the phone.
- Provisional size/freshness targets require measurement. 1,000 unusually long URLs can exceed the byte cap; both limits apply.
- No billing, taxonomy, sharing, remote tab controls, bookmark manager, public extension, or multi-device dashboard in this release.
