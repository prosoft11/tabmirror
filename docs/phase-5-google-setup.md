# Connect Google sign-in

**Completed by Daniel September 25, 2026:** local Google OAuth client creation, live sign-in and device pairing. The instructions below remain a setup reference. Farris sign-in and physical iPhone acceptance have not yet been verified.

Daniel confirmed these two approved accounts:

- `daniel.portuit@gmail.com`
- `fhassan1776@gmail.com`

They are already configured in the private local `.env` file. Do not paste the OAuth client secret into chat or put it in a `VITE_*` variable.

## Create the local development client

1. Open [Google Auth Platform](https://console.cloud.google.com/auth/overview) in a normal Chrome window and select the project intended for TabMirror development. If none exists, create a development project named **TabMirror Development** under the appropriate account/organization.
2. Complete **Branding** with app name **TabMirror** and Daniel's support/contact email. Use **External** audience because the approved accounts are personal Gmail accounts. Keep the app in **Testing** and add both approved emails as test users. Google's [platform setup guide](https://support.google.com/cloud/answer/15544987?hl=en) and [audience guide](https://support.google.com/cloud/answer/15549945?hl=en) describe these settings.
3. Under **Clients**, create a client with application type **Web application**, named **TabMirror local development**. This is the website's server-side login client; the extension uses the separate pairing protocol.
4. Add this exact **Authorized redirect URI**:

   ```text
   http://127.0.0.1:4317/api/auth/callback
   ```

   Authorized JavaScript origins are not needed by this server-side authorization-code flow. Do not add wildcard redirects. Google permits localhost IP addresses for development redirects; see [OAuth client configuration](https://support.google.com/cloud/answer/15549257?hl=en).

5. The application requests only `openid email`. If configuring the Data Access screen, keep it limited to those basic identity scopes. No Drive, Gmail, Chrome browsing, offline access or refresh-token permissions are needed. See [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect).
6. Copy the client ID and client secret into the existing **local `.env` file**:

   ```dotenv
   GOOGLE_CLIENT_ID=your-web-client-id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=your-client-secret
   ```

   Keep the existing `WEB_ORIGIN=http://127.0.0.1:4317` and approved-email settings. `.env` is ignored by Git. The client secret stays in the server process; it is not bundled into the website or extension.

7. Restart `npm run dev:auth`. Open `http://127.0.0.1:4317` in ordinary Chrome, choose **Continue with Google**, and select Daniel's approved account. Google may block OAuth in embedded application browsers, so use Chrome for the real login test.

Do not change the host to `localhost`: that is a different callback/cookie origin. If a different local port is intentionally configured, update both `WEB_ORIGIN` and Google's exact redirect registration. Register a separate HTTPS production client when the hosted domain is known; the local SQLite entry point refuses production mode.

## Pair the extension

1. Run `npm run build` and load/reload `apps/extension/dist` as an unpacked extension in a dedicated Chrome profile.
2. In the extension, name the computer and choose **Pair with my account**.
3. On the signed-in website, enter the eight-character code, choose **Review device**, and compare both the code and displayed device name with the extension.
4. Choose **Approve connection**. The extension finishes automatically while its popup is open, or through its recovery alarm after the popup closes. The pairing lasts ten minutes.
5. The website now shows connecting and first-sync progress, then automatically confirms the device is ready. Choose **View tabs** or **Your tabs** to browse its saved snapshot.

Only one active device is allowed per account in this pilot. To replace it, revoke or delete it on the website first. Revocation retains the last snapshot; deletion removes the device data. Daniel's account cannot see or manage Farris's devices.

If the pairing response is lost after the server has consumed it, start a new pairing and revoke any abandoned device shown on the site. A consumed code cannot be redeemed again. The verifier and upload token are kept in trusted extension-local storage, never in a URL or Chrome synchronized storage.

## Remaining live acceptance

After the Google client is registered, verify real sign-in for both approved accounts, rejection of a third account, logout, and real extension pairing. Before release, also verify the deployed HTTPS flow on an actual iPhone. The local tests use signed synthetic identity tokens; they do not claim to have tested Google's live consent screen or a year of elapsed browser persistence.
