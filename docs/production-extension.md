# Install and pair the production extension

Use this build with https://tabs.portuit.com. The extension in `apps/extension/dist` connects to the local API on your Mac; its codes cannot be approved on the production website. Local and production databases and pairings are separate.

1. On desktop Chrome, open `chrome://extensions` and disable the local TabMirror extension.
2. Enable Developer mode, choose **Load unpacked**, and select `artifacts/production/extension` from this repository. If using the ZIP, extract it first and select the folder containing `manifest.json`.
3. Check that the popup says **PRIVATE SYNC** and **Production: tabs.portuit.com**. Its extension ID is `biaficlopbhcnonckljljbmcfmceaaod`.
4. If the website has rate-limited previous attempts, stop retrying and wait ten minutes. Generate a fresh code afterward; codes expire after ten minutes.
5. In the desktop extension choose **Pair with my account**. Open https://tabs.portuit.com/pair, sign in, enter the new code, compare the device name and code, and approve once. Leave desktop Chrome running while it connects.
6. On your phone, sign in to https://tabs.portuit.com with the same Google account and choose **Your tabs**. A separate phone pairing is unnecessary. The phone reads tabs uploaded by desktop Chrome.

Automatic sync runs every two minutes. The website also polls every two minutes, so visibility can take roughly four minutes. Use **Sync now** in the extension, then **Refresh** on the website for an immediate check. A sleeping computer cannot upload new changes.

Build the production files with Node 22 and `npm run build:production`. This builds locally and does not deploy AWS resources. The production extension and website share the logo supplied by Daniel. Build artifacts remain outside Git.

## Chrome Web Store publication

Publish after real production pairing, upload and phone viewing pass. For the Daniel/Farris pilot, private visibility with their Google accounts as trusted testers is appropriate. Unlisted visibility allows anyone with the link to install; the app's account allowlist still applies. All visibility modes undergo policy review.

Before submission, prepare the developer account, listing/screenshots, public privacy policy, accurate browsing-data/permission disclosures, and a reviewer-access plan that does not expose Daniel's or Farris's private tabs. Obtain the Store-assigned extension ID/public key from the draft and reconcile it with the production extension origin allowlist before testing the Store build; do not assume the current unpacked ID transfers automatically. Then submit for review. No Store submission has been made.

References: [publishing process](https://developer.chrome.com/docs/webstore/publish), [distribution options](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution/), [user-data requirements](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq).
