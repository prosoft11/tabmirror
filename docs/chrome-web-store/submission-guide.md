# Private release submission checklist

## Prepared by Codex

- Mobile Approve connection scrolls to its progress area, respecting reduced-motion preferences.
- Public privacy policy and support pages, plus extension data disclosure before pairing.
- Version 0.3.0 Store draft ZIP, manifest-root layout, correctly sized icons, promotional tile and actual-UI screenshots with synthetic data.
- Listing copy, permission/data disclosures, reviewer test instructions and this walkthrough.

Run `npm run build:production`, then `node --import tsx scripts/prepare-store.ts` with Node 22 to regenerate locally. The latter runs an isolated local screenshot/test server and requires local browser/loopback permissions. Artifacts are ignored by Git; no credentials belong in the release ZIP.

## Deployment and verification record

Prepared October 2, 2026. Daniel confirmed real production pairing and phone viewing before this release. Local checks passed 121 tests, type checking, build/startup checks and formatting. The subsequent mobile scroll adjustment passed isolated Chromium checks at 390×844 with both normal and reduced-motion settings, including focus and visible progress after approval. The Store ZIP was inspected for its root manifest, bundled icon dimensions and HTTPS-only host access.

Website release: `release-1d0de6c2bd917114e738`. It includes the mobile fix, policy/support pages and authorization for the selected reviewer account. Store ID authorization and actual reviewer sign-in remain pending; the Store package has not been submitted for review.

## Daniel's next steps

1. Open https://chrome.google.com/webstore/devconsole using the registered developer account. Complete any account verification or two-step-verification prompts privately. Use the desired publisher display name. Make the required trader/non-trader or legal declarations yourself according to your actual status; Codex cannot infer them.
2. Choose **New item** and upload `artifacts/chrome-web-store/tabmirror-store-0.3.0.zip`. This creates a draft; do not click Submit for review yet.
3. Send Codex the draft's 32-letter **item ID** and **public key** (Package → View public key). These are public identifiers, not passwords. The current unpacked identity is not assumed to carry over. Codex must authorize the Store origin, preserve the existing unpacked user's access during migration, and test a build with the Store identity before submission.
4. Use the reviewer Google account Daniel selected: felixdaniel2056@gmail.com. Its authorization is included in this release. Put any sign-in credentials directly into the dashboard's private Test instructions field. Make sure the OAuth client's audience/testing settings permit Farris and the reviewer. The app's allowlist alone cannot override Google OAuth audience restrictions.
5. Paste fields from `listing.md` and `privacy-fields.md`; upload the icon, promo tile and two listing screenshots. The policy and support URLs must return public pages without sign-in before submission.
6. In publisher Account settings add Daniel and Farris to **Trusted testers**. In the item's Distribution tab choose **Private → Only trusted testers from the current publisher settings**. Do not choose Public or Unlisted. Include any other test account only deliberately. Confirm your contact email if prompted.
7. Complete private Test instructions using `reviewer-instructions.md`, verify the Store-ID build can sign in/pair/upload, then submit for review. Choose automatic publishing after approval if you want it live as soon as approved. Review timing is Google's decision; no immediate approval is promised.
8. When approved, give Farris the actual Store item URL from the dashboard. He must be signed into Chrome Web Store as fhassan1776@gmail.com to see the private listing and sign into TabMirror with that same approved account. He pairs his own desktop; his tabs stay separate from Daniel's.

No Store draft or submission is claimed until the dashboard confirms it. The initial ZIP is suitable for obtaining the draft ID; production Store-ID authorization and reviewer access are required before review. If the ZIP must change after initial upload, increase its version before re-uploading.

## Sources checked October 2, 2026

- https://developer.chrome.com/docs/webstore/publish
- https://developer.chrome.com/docs/webstore/prepare
- https://developer.chrome.com/docs/webstore/images
- https://developer.chrome.com/docs/webstore/cws-dashboard-privacy/
- https://developer.chrome.com/docs/webstore/cws-dashboard-distribution/
- https://developer.chrome.com/docs/extensions/reference/manifest/key
