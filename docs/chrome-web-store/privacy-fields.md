# Privacy practices — ready-to-paste answers

## Single purpose

Privately sync a user's currently open desktop Chrome tabs, windows and tab groups to their own authenticated TabMirror account so they can find and open those tabs on another device.

## Permission justifications

**tabs**: Read eligible open tabs' titles, URLs, window/order and pinned state for the user's saved tab view. Listen for tab changes to schedule sync. No page scripts are injected and page bodies are not read.

**tabGroups**: Read group names, colors and collapsed state to preserve the user's organization in the saved view, and observe changes for subsequent sync.

**storage**: Store the paired device credential, short-lived pairing verifier, sync/retry state and user controls locally so service-worker restarts do not lose pairing or pending work.

**alarms**: Schedule two-minute automatic syncing and retry/recovery, plus temporary pairing polling, when the Manifest V3 worker is suspended.

**https://tabs.portuit.com/**: Send authenticated snapshots and connection status to the private TabMirror API and complete device pairing over HTTPS. The extension requests no general website host access.

## Remote code

Select **No, I am not using remote code**. The screenshot currently has Yes selected; change it to No. All executable extension code is bundled in the ZIP. The backend provides data and authentication responses, not remotely executed extension code. No eval or remote script loader is used.

## Data categories

Disclose **Web history** (open-tab URLs/titles are browsing activity, despite not using Chrome's history API), **Personally identifiable information** (Google account/email and chosen device name across the connected service), **Authentication information** (pairing/session/device credentials), and **Location** because the displayed dashboard definition explicitly includes IP addresses, which the backend processes for request security and rate limiting. This does not mean the app collects GPS location. Do not claim that no data is collected merely because the release is private.

The app does not intentionally collect health, financial, payment, personal communications, page-body content, precise location, keystrokes or click-tracking data. However, full URLs, titles and group names can themselves contain sensitive personal data; the privacy policy explicitly describes this. The feature reads tab metadata, not page bodies. Never promise that arbitrary user-chosen URLs cannot contain sensitive information.

## Data-use certifications

The implementation supports these certifications: data is not sold/transferred outside the disclosed necessary uses; it is not used for purposes unrelated to the single purpose; it is not used for creditworthiness or lending decisions. The publisher must read and personally attest to the dashboard's exact statements.

Privacy policy URL: https://tabs.portuit.com/privacy.html

## Refresh behavior

Website Refresh retrieves the latest snapshot already saved on the server; it does not command desktop Chrome to capture/upload. For an immediate end-to-end update, select Sync now in the desktop extension, wait for completion, then Refresh on the website. The independent two-minute extension upload is why changes can appear later after an earlier website refresh.
