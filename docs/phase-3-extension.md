# Phase 3: private Chrome extension

The extension reads open normal windows in its Chrome profile and sends validated snapshots to a separate local development collector. The fixture website remains unchanged. Hosted access, Google login, device pairing and durable cloud storage are Phase 4/5/8 work.

## Try it locally

1. Use Node from `.nvmrc`, run `npm ci`, and copy `.env.example` to `.env` if needed.
2. Run `npm run build` to generate the unpacked extension in `apps/extension/dist`.
3. In another terminal, run `npm run dev:collector`. It binds **127.0.0.1:4319** only. It writes a new token to `.local/extension-connection.json`, with owner-only file permissions. This file is ignored by Git; do not share or commit it.
4. In a dedicated test Chrome profile, visit `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `apps/extension/dist`.
5. Open TabMirror from Chrome's extensions menu. Enter a device name and the token from the connection file, then choose **Connect & start syncing**. Connecting authorizes capture/upload of this profile's eligible tabs to the local collector.
6. Open and organize test tabs. The popup reports counts, last upload/check, and errors. Use Sync now, Save device name, Pause/Resume, or Disconnect.

The host permission is `http://127.0.0.1/*` because Chrome host match patterns do not restrict port. Code sends requests only to port 4319 and refuses redirects. This is a deliberate local-development build; no remote endpoint setting or public deployment is included.

Collector snapshots exist only in memory and reset when it stops. Its token rotates on restart; disconnect revokes the active token. Start a new collector and reconnect afterward. Disconnect always removes the local credential, even offline; its warning explicitly says when remote revocation could not be confirmed. Stopping the collector invalidates its token and discards its in-memory snapshot. Pause keeps the last snapshot and does not upload new tab contents, including on manual sync.

The collector is a development integration harness, not production authentication. Do not expose it using a tunnel or use it as a public server. The separate Phase 2 preview continues to show synthetic fixtures; it does not display the collector's real snapshots yet.

## Capture and synchronization

- Minimal `tabs`, `tabGroups`, `storage`, `alarms` permissions; no content scripts, Chrome Sync access, external messages or page-content capture. Incognito is disabled in the manifest and defensively filtered.
- Read native windows, tab indices, pinned status and group name/color/collapse metadata. If Chrome reports multiple focused windows, focus is recorded as unknown; tab contents are still captured. IDs are scoped to a session; eligible windows sort by ID, tabs by index, groups by first included tab.
- Exclude incognito without counting it; omit non-HTTP(S), missing committed URLs and credentialed URLs before serialization. Preserve query strings/fragments and duplicate URLs. Empty represented groups/windows disappear; an empty successful capture clears old data.
- Retry capture three times if Chrome events indicate a changing structure or references are inconsistent. Failure keeps the last acknowledged snapshot.
- Three-second event debounce, maximum ten-second burst wait; two-minute recovery alarm checked on every worker activation. A separate retry alarm survives short timer loss. Alarm scheduling can be delayed by Chrome and cannot wake a sleeping Mac.
- One serialized engine queue protects stored state and revisions. Persist the next revision before upload. Reconcile the remote revision after reconnect; on uncertain upload acknowledgement, capture fresh data and publish a higher revision instead of replaying obsolete content.
- SHA-256 comparison avoids uploading unchanged tab contents. Successful unchanged captures report a heartbeat. Browser-session UUID changes after browser restart; credentials/revision survive in trusted-context-only local storage.
- Requests time out after 15 seconds; network/429/server errors back off with jitter and respect Retry-After. 401 and other configuration/authentication failures require reconnect. No credential, title or URL logging in the extension/collector.
- Popup status messages omit credentials. The token field is cleared after submission. All remote strings are displayed with textContent, not HTML.

## Verification

Run `npm run check` for unit/HTTP/build checks. Install the test browser with `npx playwright install chromium`, then run `npm run test:extension` for an isolated-profile extension test. Port 4319 must be free; stop a manually running collector first.

The browser test creates only synthetic example.test pages, loads the actual unpacked extension, and removes its temporary profile on completion. It does not touch personal browser profiles. `artifacts/phase3-extension.png` is an ignored screenshot of the tested popup. Physical Mac sleep/wake and long-term daily-use reliability remain later acceptance checks; worker shutdown/restart and alarm recovery are exercised separately.

Official references: [Windows API](https://developer.chrome.com/docs/extensions/reference/api/windows), [tab groups](https://developer.chrome.com/docs/extensions/reference/api/tabGroups), [storage](https://developer.chrome.com/docs/extensions/reference/api/storage), [alarms](https://developer.chrome.com/docs/extensions/reference/api/alarms), [Playwright extension testing](https://playwright.dev/docs/chrome-extensions).

## Phase 4 durable backend

Use `npm run dev:private` instead of the in-memory collector to retain snapshots and credentials across API restarts. It uses the same loopback port 4319; run only one service there. Connect the extension using `deviceToken` from `.local/private-connection.json`. The separate `viewerToken` reads and manages devices. See [Phase 4 setup](phase-4-private-api.md).

## Phase 5 account pairing

The default popup action is now **Pair with my account**. Run `npm run dev:auth`, complete [Google setup](phase-5-google-setup.md), then review and approve the extension code on the signed-in site. Manual tokens remain under **Developer connection** for the older test harnesses.
