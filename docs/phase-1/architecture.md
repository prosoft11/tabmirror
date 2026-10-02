# Architecture decisions and feasibility

Status: accepted implementation defaults, subject to company AWS conventions. Documentation review completed 2026-09-21; live Chrome experiments belong to Phase 3.

## Decisions

1. **Direct capture, not Chrome Sync.** Read `chrome.windows.getAll({populate:true, windowTypes:['normal']})` and `chrome.tabGroups.query({})`. Request `tabs`, `tabGroups`, `storage`, `alarms`; restrict host permissions to the configured API origin. Set manifest `incognito: 'not_allowed'` and defensively filter incognito objects. No content scripts, identity/email permission, broad host access, native helper, or page fetches.
2. **Single ordered tab list per window.** Store tab indices and nullable group IDs with separate group metadata. This avoids duplicating tabs and preserves ungrouped runs. IDs are transient and keyed with browser session UUID for UI state. Refresh session UUID through `storage.session`; keep device revision in `storage.local` across browser restarts. Losing persistent credential/revision state requires pairing a new device.
3. **Latest snapshot service.** TypeScript workspace, React/Vite web, MV3 extension, Lambda API, private S3 snapshot objects, DynamoDB metadata/auth, CloudFront static hosting and API routing, CDK infrastructure. Only shared schema/documents are introduced in Phase 1; package/version setup is Phase 2.
4. **Server-derived ownership.** Device credentials resolve device/owner server-side. No upload accepts user ID, device ID, device name, server timestamps, or storage keys. Google subject is identity; device ID is server generated. Web responses wrap snapshots in server-owned metadata.
5. **Monotonic per-installation revision.** Positive safe integer persists before each new upload. One upload in flight; retries of the exact body reuse revision. Same revision + same server-computed SHA-256 hash is success without changing receipt time; same revision + different body or lower revision is 409. Counter survives browser-session changes. Authenticated reconnect reads only accepted revision/status to reconcile uncertain writes; recovery captures new state above the server revision. Client clock never orders writes.
6. **Durable publication.** Upload validates/authenticates, writes immutable S3 candidate, then conditionally publishes its pointer in DynamoDB only if revision is newer and device is still active. Publication and active-device check must be one conditional transaction. Reader obtains current metadata, loads object, and rechecks pointer/deletion state before returning; retry on replacement/deletion races. A rejected or failed publication queues its candidate for deletion. Do not expose bucket keys or signed object URLs to the phone.
7. **No browsing archive.** Superseded candidates are deleted promptly, with hourly orphan reconciliation and a 24-hour cleanup target. Reconciler deletes only objects older than a one-hour grace period that are not current; publications must reject candidates older than five minutes, so a late write cannot publish an object selected for cleanup. Re-read pointer before deletion. Bucket versioning/replication/backups are disabled for snapshot payloads; no bucket-wide age expiry that could delete the current snapshot. Revoked devices retain last snapshot until deletion. Deletion tombstones immediately, then removes objects/metadata within 24 hours. Infrastructure configuration and code backups may remain, without tab data.
8. **One origin.** Static web and `/api` share HTTPS origin. Disable CDN caching for all API/auth routes and forward relevant cookies/headers. Local adapters exercise the same contracts. Production fails closed without auth/storage configuration.

## Capture and scheduling algorithm

Register event listeners synchronously at worker startup: tabs created/updated/removed/moved/attached/detached, groups created/updated/moved/removed, windows created/removed/focus changed, runtime startup/install, alarms. Focus is metadata only; not an ordering rule. Native group cross-window moves can arrive as removal/creation events.

Mark dirty persistently and use a 3-second trailing debounce, with a maximum 10-second wait during continuous activity. The short timer is only a fast path. A 2-minute repeating alarm is ensured at every worker start and recaptures or heartbeats after suspension. Startup and manual sync capture immediately. Alarm timing can be delayed and does not wake a sleeping device.

Read window/tab structure and group metadata, check references and capture event generation. If structure changed during capture or references are inconsistent, retry up to three times, then leave dirty with a visible error and preserve last complete snapshot. Chrome provides no atomic whole-browser snapshot, so this reduces races without claiming an exact instant-in-time transaction. Successful no-eligible-tab capture is a real empty snapshot.

Filter before serialization; omit unsupported/credentialed URLs, missing committed URLs, empty windows/groups. Normalize missing title to empty string; UI falls back to hostname. Preserve committed URL query/fragment; never use `pendingUrl`. Store no favicon. Tab IDs and indices remain original; index gaps are expected after filtering. Enforce aggregate/byte limits before upload, server validates independently.

Hash normalized content excluding revision/capture timestamp. If unchanged since acknowledged state, heartbeat instead of uploading; heartbeat includes accepted revision and new successful check time. If no successful capture happened, report error status without claiming snapshot verification. New content reserves a revision and uploads. Retry network/429/5xx with jittered 5s-to-5min backoff respecting Retry-After; stop and request reconnect on 401. Use 15-second request timeout; recover through alarms rather than keeping worker alive. Persist dirty/revision/ack metadata, not a historical upload queue.

Foreground web polling target 5 seconds, stop when hidden, refresh on visibility/manual request. Normal 15-second target includes debounce, network, and polling and must be measured. Staleness uses server receipt of last successful verification, not client wall clock. Keep error/paused status separate from data freshness.

## API draft

JSON only; unknown properties rejected. Errors: `{error:{code,message,retryable},requestId}` without secrets. 400 invalid schema/relations, 401 absent/expired credential, 403 disallowed account/operation, 404 unavailable or other-owner resource, 409 revision/pairing conflict, 413 byte/count limit, 429 throttled, 503 transient storage failure. Pairing-state polling uses explicit pending/approved/denied/expired states. All private/auth responses use `Cache-Control: no-store`.

| Route                                                     | Auth and behavior                                                                                                                 |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| GET /api/auth/google/start; GET /api/auth/google/callback | OIDC redirect/callback; allow only configured local return paths                                                                  |
| GET /api/session                                          | Web session identity/status and CSRF token; never underlying session credential                                                   |
| POST /api/logout                                          | Web session + CSRF; revoke and expire cookie                                                                                      |
| POST /api/pairings                                        | Public rate-limited start; verifier hash + device display name; returns opaque ID and human code, expires in 10 minutes           |
| POST /api/pairings/approve                                | Web session + CSRF; human code and explicit confirmation; binds owner atomically                                                  |
| POST /api/pairings/redeem                                 | Pairing ID + secret verifier, single use; returns device ID and bearer credential; pending polls no faster than 5s                |
| GET /api/device/status                                    | Device bearer; accepted revision, sync state, device name only, no snapshot read                                                  |
| PUT /api/device/snapshot                                  | Device bearer; schema payload; returns accepted revision and server receipt time                                                  |
| POST /api/device/heartbeat                                | Device bearer; accepted revision, successful checkedAt or explicit capture error/paused state; cannot make unknown revision fresh |
| POST /api/device/disconnect                               | Device bearer; revokes itself; local disconnect handles network failure explicitly                                                |
| GET /api/devices                                          | Web session; owned device metadata                                                                                                |
| GET /api/devices/:id/snapshot                             | Web session; current snapshot envelope or explicit not-yet-synced state                                                           |
| POST /api/devices/:id/revoke                              | Web session + CSRF; revoke device and cancel its pending writes                                                                   |
| DELETE /api/devices/:id                                   | Web session + CSRF; tombstone/revoke and enqueue data purge                                                                       |

Snapshot response envelope: `{device:{id,name,status},receivedAt,lastContactAt,lastVerifiedAt,snapshot}`. Timestamps nullable until applicable. Server sets receipt/contact/verification; snapshot's capturedAt is informational client time. Pausing can only be reported to cloud while network is available, so UI says last-known status. Exact schemas for these non-snapshot routes follow during their implementation.

## Evidence and feasibility boundaries

- [Chrome tabs](https://developer.chrome.com/docs/extensions/reference/api/tabs): `tabs` permission exposes URL/title metadata; discarded tabs remain represented.
- [Chrome windows](https://developer.chrome.com/docs/extensions/reference/api/windows): enumeration/filtering supports normal windows and populated tabs; window IDs are browser-session identifiers, not enduring labels.
- [Chrome tab groups](https://developer.chrome.com/docs/extensions/reference/api/tabGroups): names, colors, collapsed state and window association; cross-window moves use remove/create events.
- [Worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle) and [alarms](https://developer.chrome.com/docs/extensions/reference/api/alarms): workers terminate; recreate/check alarms on startup and recover after sleep. Avoid relying on version-specific persistence flags.
- [DynamoDB constraints](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Constraints.html): 400 KB per item motivates separate snapshot payload storage.
- [Chrome identity](https://developer.chrome.com/docs/extensions/reference/api/identity): profile information is an extension capability requiring permission. Inference: it supplies no documented mechanism to establish the signed-in Chrome profile of the remote iPhone webpage. Do not add permissions or claim this feature works. Proposed replacement is renewable application sessions for all approved browsers; R07 remains unresolved with stakeholder.

## Phase 4 local storage implementation

The durable development adapter uses a single SQLite transaction for credential checks, full snapshot replacement and metadata. It stores one snapshot in each device row; superseded and orphan object cleanup is therefore unnecessary locally. This does not replace the planned DynamoDB/S3 cloud adapter or its cleanup rules above. See [Phase 4 implementation and verification](../phase-4-private-api.md) for the adapter boundary and deployment limitations.
