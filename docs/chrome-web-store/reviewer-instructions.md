# Reviewer instructions

Reviewer account authorized by Daniel: **felixdaniel2056@gmail.com**. Keep its TabMirror data limited to synthetic tabs. Put any sign-in credentials only in the dashboard’s private Test instructions field, never Git or chat. Account authorization is being deployed with this release; actual reviewer sign-in must still be verified, including Google OAuth audience/testing settings.

Suggested dashboard text, after the account is prepared:

TabMirror is a private release for approved users. The test Google account supplied in the private credentials field has isolated data and access to the same production flow as other approved users. Use only synthetic example tabs during review.

1. Install the submitted extension in a clean desktop Chrome profile. Open https://example.com and https://developer.chrome.com/docs/extensions/ in tabs, and optionally put them in a named Chrome tab group.
2. Open TabMirror, read the data disclosure, enter a device name, and choose Pair with my account.
3. Sign in at https://tabs.portuit.com/pair using the provided test Google account. Enter the extension's fresh eight-character code, compare the code/device name, and approve once. A code expires in ten minutes.
4. Keep Chrome running. The extension completes pairing and uploads the first snapshot. Open Your tabs to see grouped tabs. Sign into the same account on a phone to view them there; no phone extension or second pairing is required.
5. Search for a title or URL, collapse/expand groups and open an individual link. Add or rename a group in Chrome. Automatic sync runs every two minutes and website refreshes independently every two minutes. For an immediate check, choose Sync now in the extension and Refresh on the website.
6. Pause syncing and verify the last snapshot remains. Resume, then test revoke/delete with these synthetic tabs. In Account & devices, revoke before pairing a replacement device; one active desktop device is supported per account.
7. Incognito windows and chrome://, file:// and other unsupported schemes are excluded. The extension has no page content scripts. It does not modify or remotely close desktop tabs.

If repeated pairing attempts trigger a rate limit, wait ten minutes, generate a fresh code and try once. Support: daniel.portuit@gmail.com.

Google sign-in may demand an interactive security check on a new reviewer device. Validate the dedicated account on a separate clean browser and ensure Google offers a workable sign-in method for the reviewer; do not disable production authentication or add a review-only bypass. If Google blocks sign-in, resolve the review-access method before submission.
