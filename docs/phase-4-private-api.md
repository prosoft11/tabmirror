# Phase 4 — Private API and durable storage

Implemented September 23, 2026. The private API now has a durable **local SQLite adapter** and an asynchronous storage interface for the future cloud adapter. Google login, session cookies and pairing remain Phase 5. The existing web preview continues to display fixtures until the authenticated viewer is integrated.

## Run it

With the pinned Node 22 runtime and existing `.env`:

```sh
npm run dev:private
```

This listens only on `http://127.0.0.1:4319`. Stop the old `dev:collector` first if it is using that port. The original fixture API/web preview can continue running on 4318/4317. `PRIVATE_API_PORT` can override the private port for backend testing; the development extension is fixed to 4319.

On first startup the service creates:

- `.local/private.sqlite`: users, hashed credentials, device metadata and current snapshots.
- `.local/private-connection.json`: `endpoint`, `deviceId`, `deviceToken`, `viewerToken`. This file contains secrets and has mode 0600. It is ignored by Git.

Load the extension as described in the Phase 3 guide, then connect with **deviceToken**. The viewer credential is separate and cannot upload. The extension credential cannot read snapshots or list devices. Startup preserves both tokens and accepted data. A revoked token stays revoked across restarts. These manually provisioned local credentials expire after 365 days; renewable web sessions and the real credential issuer are Phase 5 work.

To inspect the local device list without printing credentials, run from the project root:

```sh
node --input-type=module <<'JS'
import { readFile } from 'node:fs/promises';
const connection = JSON.parse(await readFile('.local/private-connection.json', 'utf8'));
const response = await fetch(`${connection.endpoint}/api/devices`, {
  headers: { Authorization: `Bearer ${connection.viewerToken}` },
});
console.log(response.status, await response.json());
JS
```

Read a snapshot using `/api/devices/<deviceId>/snapshot` with `viewerToken`. Use the same viewer credential for `POST /api/devices/<deviceId>/revoke` and `DELETE /api/devices/<deviceId>`. Revocation stops extension access but retains the snapshot for the owner; deletion removes the device, its snapshot and device credentials in one transaction. Other accounts receive 404 for all of these operations.

Provisioning is an internal `SqlitePrivateStore.provision()` seam, not an unauthenticated HTTP route. After a local disconnect/revocation, a new credential must be provisioned; the upcoming pairing flow will handle this. Do not delete the database to reconnect: that would erase saved data.

The bundled entry point is `node --env-file=.env apps/api/dist/private-main.js`. Both missing local-development configuration and production mode fail closed. This entry point must not be exposed publicly.

## API contract

Every authenticated request uses `Authorization: Bearer <64-lowercase-hex-token>`. Upload/heartbeat bodies use uncompressed UTF-8 `application/json`. Bearer authorization is a local integration seam; no ambient browser cookies are accepted here.

| Method and endpoint             | Credential | Result                                                |
| ------------------------------- | ---------- | ----------------------------------------------------- |
| `GET /api/health`               | None       | Storage health; no private data                       |
| `GET /api/device/status`        | Device     | Current accepted revision                             |
| `PUT /api/device/snapshot`      | Device     | Validates and atomically replaces current snapshot    |
| `POST /api/device/heartbeat`    | Device     | Updates contact, name, pause state and verification   |
| `POST /api/device/disconnect`   | Device     | Revokes this device                                   |
| `GET /api/devices`              | Viewer     | Only this owner's devices and metadata                |
| `GET /api/devices/:id/snapshot` | Viewer     | Owned device, timestamps and current snapshot or null |
| `POST /api/devices/:id/revoke`  | Viewer     | Revokes uploads; retains last snapshot                |
| `DELETE /api/devices/:id`       | Viewer     | Removes device data and upload credentials            |

Errors have `{ error: { code, message, retryable }, requestId }`. Responses are `no-store`. Relevant statuses: 400 invalid payload, 401 invalid/expired/revoked/wrong-scope credentials, 403 rejected host/origin, 404 missing or unowned device, 409 revision conflict, 413 capacity exceeded, 415 unsupported encoding/media, 429 throttled (`Retry-After: 60`), and 503 storage failure. Request IDs are also returned as `X-Request-Id`.

Local limits are 120 requests per credential per minute and 480 per source IP per minute, with a bounded in-process bucket map. They reset on process restart and are not a distributed limiter. Snapshot bodies are limited to 2 MiB plus the shared schema's 1,000-tab/20-window/100-group and field limits; heartbeat bodies to 4 KiB. Oversized, malformed, duplicate-key and invalid UTF-8 requests do not replace saved data. The server bounds request time; an upload still pending after five minutes cannot publish.

## Publication, ownership and freshness

Authentication is repeated inside each storage transaction, after the HTTP body has been read. The owner and device come from the credential record. Disabled accounts, expired credentials, revocation and deletion all prevent further writes, including requests already in flight.

SQLite `BEGIN IMMEDIATE` serializes writers. A higher revision atomically replaces the snapshot and its metadata. The same revision and exact raw-body SHA-256 digest returns the original acknowledgement. A lower revision or equal revision with different bytes returns 409. No partial snapshot is observable, and failed transactions preserve the previous accepted record. A valid empty snapshot clears prior tabs.

Timestamps are server-generated and distinct:

- `receivedAt`: when the current snapshot revision was accepted; retries preserve it.
- `lastContactAt`: last accepted upload/retry/heartbeat.
- `lastVerifiedAt`: last new snapshot or active heartbeat verifying the accepted revision. Paused heartbeats and old duplicate uploads do not renew it.
- `lastContentChangedAt`: last change to normalized snapshot content, excluding capture time and revision.

`capturedAt` and heartbeat `checkedAt` remain client claims, not authoritative server freshness clocks. Browser-session identity remains part of content because native tab/window identifiers are scoped to that session.

## Storage decision and cloud boundary

The local adapter stores the complete snapshot **inside the device row**. That is a deliberate local implementation of the latest-only contract: there are no pending objects, superseded object files or orphan objects to sweep. Replacement and deletion happen in the same transaction as metadata/authorization changes. The rollback journal is deleted at commit, and `secure_delete=ON` overwrites removed SQLite content. `synchronous=EXTRA` adds the rollback-journal directory synchronization documented by [SQLite](https://sqlite.org/pragma.html#pragma_synchronous). These settings do not erase independent OS backups, filesystem snapshots or physical storage remnants.

This uses Node's built-in [`node:sqlite` API](https://nodejs.org/download/release/v22.13.1/docs/api/sqlite.html); the pinned Node 22 runtime emits an experimental API warning. No third-party runtime dependency was added. This is a single-host development adapter, not a SQLite-on-Lambda deployment design.

`PrivateStore` is the asynchronous local-to-cloud boundary. A future DynamoDB/S3 implementation must preserve authenticated conditional publication and read/delete semantics. The Phase 1 cloud design remains required: immutable pending object, conditional metadata pointer publication, active-account/device checks, publication deadline, prompt superseded cleanup and an hourly orphan sweep with a one-hour grace period and pointer recheck. S3 versioning/backups must not accidentally introduce browsing history. Those cloud-specific object jobs are not implemented or deployed in this local phase; they belong with the cloud adapter and infrastructure before hosted acceptance.

Operational logging accepts only request ID, a fixed operation name, status and duration. It never receives URLs, request paths, tab titles, snapshot bodies, credentials or database errors. Raw tokens exist only in the private local connection file and client storage; credential rows contain SHA-256 digests. No AWS resources, Google credentials or external messages were created.

## Verification

- `npm run check`: typecheck, 76 tests, all builds, bundled API checks and formatting pass.
- The bundled private API survives **SIGKILL after an acknowledged upload** with its snapshot and credentials intact; deletion also persists across restart. Production startup refusal is exercised.
- HTTP/storage tests cover account/scope isolation, expiry, disabled accounts, revocation during upload, competing revisions, duplicate retries, capacity/UTF-8/JSON failures, timestamp semantics, rate limiting, safe logging, empty snapshots, deletion and injected SQLite write failure/rollback.
- `npm run test:private-extension`: isolated actual Chromium verifies capture, native groups/order, moves, changes, rename, pause/resume, worker restart, offline/alarm recovery with retained data, browser restart, empty replacement and disconnect/revocation.
- Browser evidence: `artifacts/phase4-extension.png` (synthetic data, ignored by Git).

The checks use temporary databases and browser profiles and clean them afterward. No real browsing data or existing local credential files were used. Live Google authentication, cloud persistence, distributed throttling, physical power-loss durability and real iPhone behavior have not been verified in this phase.
