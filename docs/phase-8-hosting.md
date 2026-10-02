# Application hosting deployment

October 2, 2026. Daniel authorized application hosting and alerts after entering the production OAuth values. The ACM certificate is ISSUED. Secret metadata confirms an AWSCURRENT version; no secret values were fetched or copied by the agent.

## Two-minute cost-saving schedule

Automatic Chrome capture/upload and foreground website polling now run on two-minute intervals. Browser events mark state dirty without immediate network uploads. The automatic deadline is persisted across service-worker restarts; retries also respect it. Pairing, explicit manual sync, rename and pause/resume controls remain immediate. Pairing completion retains short polling while connecting. The website refreshes immediately when opened or brought back into view, and manual Refresh retrieves the latest saved snapshot.

Because capture and viewer polls have separate schedules, changes can take up to approximately four minutes to become visible while both are active. Sleeping/background devices can take longer. The previous 15-second freshness acceptance target is superseded by Daniel's October 2 request. Freshness timestamps still show the actual capture and contact times.

Validation: 121 tests passed. Real Chromium with synthetic OIDC and a separate phone-sized browser passed pairing, automatic upload, group creation/rename, Unicode/long titles, duplicate URLs, revocation and logout. Measured group creation visibility: 120634ms; rename: 120266ms. Real production Google sign-in and physical iPhone/cellular acceptance remain separate checks.

## Pilot cost model

Planning assumptions per month: 100,000 HTTP/API invocations, 512 MiB Lambda averaging 300ms, two million DynamoDB read units and one million write units (including transactional overhead), 1GB metadata/PITR, 1GB S3, 50,000 PUTs, 10,000 GETs, 1GB log ingestion, four standard alarms and one secret. Scripted total: **$5.22**, including a **$2 contingency for CloudFront, email, retained logs/assets and incidental usage**. That contingency is not a measured CloudFront quote. No free-tier allowances are assumed. Taxes, unrelated workloads, higher usage and abusive traffic are excluded. This is a model, not a guaranteed bill.

Regional Lambda, DynamoDB, HTTP API, S3 storage and CloudWatch rates were read from the AWS Price List API for us-west-2. S3 request assumptions are supported by [AWS's published Standard request rates](https://docs.aws.amazon.com/solutions/latest/automated-security-response-on-aws/cost.html); the secret uses [Secrets Manager pricing](https://aws.amazon.com/secrets-manager/pricing/). Raw non-secret pricing data and the calculation are saved under artifacts. The CloudFront pricing CLI query twice timed out in automatic approval review, so no successful API quote is claimed for that service.

The $10 monthly budget covers the whole AWS account and sends an actual-spend notification; it does not stop spending. Operational alerts require Daniel to confirm the SNS email subscription. Alarm delivery and rollback must be verified after deployment.

## Deployment controls

The us-west-2 bootstrap now contains a second inline execution policy for TabMirror application resources. It uses no AdministratorAccess managed policy. Role management and PassRole are limited to TabMirrorApplication roles and Lambda; the runtime role has scoped log/table/object permissions. CloudFormation can resolve only the exact production OAuth secret. The agent must never request its value or print Lambda environment configuration.

CloudFront create operations require Resource `*`; those grants are limited to four named create actions. Subsequent CloudFront operations use account-specific resource types and the actual generated function-name prefix. API Gateway control is limited to HTTP APIs in us-west-2; log delivery requires regional control-plane permissions. These deployment permissions are separate from the much narrower Lambda runtime permissions. IAM actions were checked against AWS's public service authorization metadata.

The approved production files and cloud assembly are kept together. Website uploads use an immutable release prefix. Application deployment, public smoke tests, exact CloudFront CNAME and final alert status will be recorded below.

## Hosted verification and handoff

CloudFront distribution `E3AZ53CCRACNN4` serves `d3mb0xcpqurt6f.cloudfront.net`. In NameSilo add a CNAME with host `tabs` and value `d3mb0xcpqurt6f.cloudfront.net`; retain the certificate validation CNAME and leave apex/www unchanged. Public DNS had no tabs CNAME when checked.

The initial deployment required API Gateway TagResource permission. A preserved-resource retry completed. Live smoke then found an omitted jsonc-parser UMD dependency; production bundling now prefers the package's module entry and imports the finished bundle in an isolated temporary directory to catch missing runtime dependencies. The repaired release is `release-d75067e6c30fca4a2d99`. The original failed bundle is archived for diagnosis, not a valid rollback target.

Hosted smoke passed on October 2: validated canonical TLS, website and pairing route, no-store session response, anonymous/forged-session/cross-origin rejection, database health, real Google discovery and PKCE login initiation, and Secure/HttpOnly/SameSite login cookie. No secret, cookie or Google authorization URL was printed. Evidence: `artifacts/hosting/smoke.json`. The 12 cloud regression tests and formatting passed; loopback tests required sandbox escalation.

Four operational alarms have enabled SNS actions. SNS email subscription is PendingConfirmation for daniel.portuit@gmail.com; Daniel must click Confirm subscription in AWS's email before alarm delivery can be tested. Budget metadata confirms account-wide USD10 monthly, actual spend above 100%, emailed to Daniel. It is not a spending cap.

After DNS propagation, open https://tabs.portuit.com and sign in with Google. Load `artifacts/production/extension` in Chrome via chrome://extensions → Developer mode → Load unpacked, then pair with the production account. The local extension's pairing does not transfer. Disable local syncing while testing production. Stable production extension ID: `biaficlopbhcnonckljljbmcfmceaaod`.

Still pending: real Google completion, live paired upload/read and S3 cleanup, physical iPhone/cellular and Farris acceptance, confirmed alert delivery, and rollback rehearsal. Phase 8 is not fully accepted yet.
