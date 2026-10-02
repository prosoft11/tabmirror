# Phase 8 — Deployment preparation

Updated October 2, 2026. **Production candidate implemented and locally verified. AWS hosting and alerts provisioned; hosted smoke passed; DNS and production acceptance pending.** Phase 7 local automation can run without AWS access. Physical iPhone/cellular acceptance follows the hosted deployment.

## Confirmed inputs and account gate

The default AWS profile passed `aws sts get-caller-identity --profile default --region us-west-2` on October 2, 2026: account **400745793130**, principal `arn:aws:iam::400745793130:user/daniel.portuit@gmail.com`. This verifies identity, not deployment permissions. No credentials were printed, copied or committed. Daniel subsequently authorized foundation provisioning; see the [foundation record](phase-8-foundation.md).

Non-secret settings are recorded in `infra/production-settings.json`:

| Setting                    | Value                                               |
| -------------------------- | --------------------------------------------------- |
| AWS account / profile      | `400745793130` / `default`                          |
| Regional services          | `us-west-2`                                         |
| CloudFront ACM certificate | `us-east-1`                                         |
| Public hostname            | `tabs.portuit.com`                                  |
| DNS provider / operator    | NameSilo / Daniel                                   |
| Alarms and budget alerts   | `daniel.portuit@gmail.com`                          |
| Monthly budget alert       | USD 10                                              |
| Production Google callback | `https://tabs.portuit.com/api/auth/callback`        |
| Approved Google emails     | `daniel.portuit@gmail.com`, `fhassan1776@gmail.com` |

Foundation provisioning is authorized. Re-run the identity check before any provisioning/change set execution and stop on failure or account mismatch. Always explicitly select the default profile and intended region; certificate operations use `us-east-1`. Deployment permissions and existing account conventions still need inspection.

## DNS and Google secret handoffs

- Preserve the existing `portuit.com` apex and `www` records. Do not manage the zone with Route 53 or change its nameservers.
- After ACM requests the certificate for `tabs.portuit.com` in `us-east-1`, retrieve its exact DNS validation CNAME name and target. Give Daniel both values for NameSilo; wait for certificate issuance. Do not invent validation records before ACM returns them.
- After CloudFront creates the distribution, give Daniel its exact `d….cloudfront.net` hostname as the target for the `tabs` CNAME. No DNS writes will be made by the deployment workflow. Keep the certificate validation record for renewal.
- Use a separate production Google OAuth client with the callback above. Preserve the local development client and `.env`.
- When the server-only Secrets Manager resource in `us-west-2` is ready, provide Daniel its exact console location and expected fields (`clientId`, `clientSecret`). Daniel enters the production values directly there. Never request the secret in chat, read it into tool output, or put it in client assets. Verify configuration through metadata and sign-in behavior.
- Give Daniel any email-subscription confirmation instructions when monitoring is provisioned. Plan the USD 10 monthly budget notification separately from application error alarms.

The exact certificate-validation CNAME is recorded in the [foundation handoff](phase-8-foundation.md). CloudFront has not yet been created, so its tabs CNAME target is not available.

## Proposed resources

| Component          | Proposed configuration                                                                                                                                                                                                                                                                                                                                   |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public entry point | CloudFront HTTPS distribution; private static S3 origin using origin access control; exact SPA routes `/` and `/pair` only. Do not rewrite API errors to HTML.                                                                                                                                                                                           |
| API                | API Gateway HTTP API → Lambda, bundled dependencies, pinned runtime supported at release. All API responses `no-store`; CloudFront `/api/*` uses caching disabled and forwards authentication cookies, Authorization, CSRF, Origin and callback query strings.                                                                                           |
| Storage            | DynamoDB on-demand for users, hashed credentials, sessions, pairing, rate limits and current-snapshot pointers; private encrypted S3 for snapshots exceeding DynamoDB's item limit. Block public access. No intentional snapshot history.                                                                                                                |
| Authentication     | Server-only Secrets Manager entry for a production Google OAuth web client; callback `https://tabs.portuit.com/api/auth/callback`. Same two-email allowlist, verified identity checks, Secure/HttpOnly/SameSite cookies, CSRF and one-time pairing.                                                                                                      |
| Extension          | Separate production build, exact HTTPS API host permission, stable public extension identity and corresponding exact server origin allowlist. No production credentials embedded in the build. Keep the local development build separate.                                                                                                                |
| DNS/TLS            | DNS ownership validation and ACM certificate in `us-east-1` for CloudFront; alias/CNAME according to the DNS provider.                                                                                                                                                                                                                                   |
| Monitoring         | Bounded operational metadata only; 14-day application log retention proposed. Alarms for API errors, Lambda errors/throttling, storage failures and failed cleanup; USD 10 monthly budget notifications and operational alarms to `daniel.portuit@gmail.com`. No request bodies, tab URLs/titles, cookies, authorization codes or query strings in logs. |
| Release artifacts  | Versioned application assets and immutable Lambda versions/alias, deployment manifest and hashes. Browsing data and local `.env`/SQLite files must never enter release bundles.                                                                                                                                                                          |

AWS documents [CloudFront certificate region requirements](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-requirements.html), [API-origin request policies](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-origin-request-policies.html), and [DynamoDB's 400 KB item limit](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Constraints.html). API-origin Host handling must match API Gateway while the application uses the configured public origin for authentication; do not trust arbitrary forwarded host headers.

## Implementation delivered

The production candidate now includes an asynchronous auth contract; transactional DynamoDB authentication, pairing, revisions and durable rate limits; immutable S3 object publication with conditional pointer updates; a scheduled cleanup registry; and a Lambda/API Gateway v2 bridge. Existing local authentication tests continue to pass. Production builds use the HTTPS hostname and a stable separate extension identity, and omit the local SQLite bootstrap.

Three CDK stacks synthesize without AWS lookups: `TabMirrorCertificate`, `TabMirrorData`, and `TabMirrorApplication`. Runtime IAM is scoped to the table and snapshot object prefix. CDK bootstrap/deployment roles are separate and still require review. The data foundation and hosting have been applied; the certificate is issued. See [hosting evidence](phase-8-hosting.md). See the [runbook](phase-8-runbook.md) and [verification record](phase-8-verification.md).

### Retention and operational limits

Device deletion immediately removes access and queues its snapshot for physical deletion. Cleanup runs every 15 minutes and processes up to 50 due objects per invocation; backlogs or failures can extend deletion time. Superseded and interrupted uploads use the same cleanup protocol. Live objects are protected by conditional writes. Cleanup tombstones remain for one day to catch late object writes.

Snapshots are not versioned. DynamoDB metadata has seven-day point-in-time recovery, so deleted metadata can remain in managed backups. Restoring metadata does not restore deleted snapshot bodies and must never resurrect revoked credentials. Web release assets are versioned and retained separately. The object registry uses a small-pilot query pattern; review scaling and cleanup throughput before expanding beyond the two-user pilot.

The $10 monthly budget is account-wide, including unrelated workloads, and is an alert rather than a spending cap. Four operational alarms target API errors, Lambda errors, Lambda throttling and DynamoDB throttling. Scheduled cleanup failures count as Lambda errors. Email delivery and rollback are not yet verified.

## Cost preparation

Do not assume an AWS free tier or promise a monthly price before measured usage and service charges are assessed. Example pilot load: two viewers using the page two hours daily generate about 54,000 eight-second polls per 30-day month, or 108,000 session/device-list requests, plus snapshot reads. Two desktops running 12 hours daily generate roughly 21,600 two-minute recovery checks per month, plus change-triggered requests. Actual operation counts, request sizes, function durations, DynamoDB transactions, cleanup, logs, Secrets Manager, DNS and data transfer must be included.

Price those assumptions in `us-west-2` (with global CloudFront and the `us-east-1` certificate) using [Lambda pricing](https://aws.amazon.com/lambda/pricing/), [API Gateway pricing](https://aws.amazon.com/api-gateway/pricing/) and the other selected services before presenting a concrete infrastructure change summary. The eight-second polling interval trades a modest increase in requests for the planned foreground freshness target.

## Deployment and verification sequence

1. Verify account/region, deployment role and DNS ownership; prepare cost estimate and infrastructure change set.
2. Provision the reviewed stack, configure the server secret without displaying it, set the exact Google callback and allowed users, and produce the production extension bundle.
3. Test HTTPS redirects, restrictive origin access, uncacheable authenticated responses, secure cookies, unauthorized access, pairing, account isolation, revocation/deletion and production storage recovery through the public endpoint.
4. Run the physical iPhone and second-network checklist in [Phase 7](phase-7-verification.md). Local-loopback tests cannot establish these properties.
5. Trigger a controlled monitoring failure and verify the operator receives it; record the notification destination and response steps.
6. Rehearse rollback and record released versions, endpoint, exact configuration and acceptance results. Only then mark Phase 8 complete.

## Rollback design

Retain the previous web asset release and Lambda version. Publish web assets under immutable release keys; change the active entry point and Lambda alias together using the deployment manifest, then invalidate only the HTML entry points if needed. Keep API changes compatible with installed extension releases. Roll back code/configuration only; never restore old browsing snapshots as part of an application rollback. Schema changes require backward-compatible migrations or a separate tested recovery procedure. Re-run login, authorized snapshot read, extension upload and cache/privacy smoke tests after rollback.

These are planned procedures. No rollback infrastructure or alarm delivery has been exercised in AWS yet.
