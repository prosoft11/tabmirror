# Phase 8 operator runbook

Status: hosting and alerts provisioned October 2, 2026; certificate issued and hosted smoke passed. Final DNS, email confirmation and production acceptance remain. See [hosting evidence](phase-8-hosting.md).

## 1. Identity, review and release

Use Node 22.22.3 and the default AWS profile. Never print credentials or load the local development `.env` into production tooling.

```sh
npm run aws:preflight
npm run check
npm run infra:synth
```

Stop if the account is not `400745793130`. Inspect all three templates in `artifacts/cdk.out`, especially IAM, retention and resource replacement. Preserve the synthesized assembly and the production artifacts together as a release record. `artifacts/production/release.json` identifies the release and SHA-256 hashes for its API, website and extension files. Do not rebuild an approved assembly between review and deployment.

Before applying, finish the region-specific cost estimate and inspect existing resources in both regions. The proposed account-wide $10 budget is a notification, not a spending cap. Do not count on unused account free allowances. Bootstrap is also an AWS mutation: review the CDK bootstrap template, deployment trust and CloudFormation execution policy before bootstrapping account 400745793130 in us-west-2 and us-east-1. Avoid granting cross-account trust. Do not silently create an AdministratorAccess deployment role or increase the user's IAM permissions to overcome a denial.

## 2. Foundation and certificate

After provisioning is authorized and bootstrap policy is reviewed, prepare and inspect CloudFormation change sets for `TabMirrorData` and `TabMirrorCertificate` from the saved assembly. Use `--profile default` on every CDK command. The assembly pins each stack's region. Apply only those reviewed changes. Data resources and the certificate are retained and stacks have termination protection; deletion is a separate deliberate operation.

The certificate stack will wait for external DNS validation. While it is pending, obtain the certificate ARN from its CloudFormation resource metadata, then read only ACM validation metadata:

```sh
aws acm describe-certificate --profile default --region us-east-1 \
  --certificate-arn "$TABMIRROR_CERTIFICATE_ARN" \
  --query 'Certificate.{Status:Status,Validation:DomainValidationOptions[].ResourceRecord}' \
  --output json --no-cli-pager
```

Give Daniel the exact returned CNAME name and value. NameSilo may expect the name relative to portuit.com; do not append the zone twice. Leave the apex and www records unchanged. Wait for `ISSUED`; retain the validation CNAME for renewal. Never guess these values.

## 3. Production OAuth handoff

Read `GoogleSecretArn` from `TabMirrorData` stack outputs. Daniel opens Secrets Manager in us-west-2, secret `tabmirror/production/google-oauth`, and enters the production client's two string fields, `clientId` and `clientSecret`, directly in the console. Do not paste either value into chat or a release file. Confirm a current version exists through `DescribeSecret` metadata only; never call `GetSecretValue` through agent tools.

Google's authorized redirect URI must be exactly `https://tabs.portuit.com/api/auth/callback`. Keep the local OAuth client unchanged. The app allowlist remains Daniel and Farris. CloudFormation resolves the secret dynamically when configuring Lambda; runtime and deployment access to function configuration must remain restricted. Secret rotation requires a deliberate application configuration update; changing Secrets Manager alone does not refresh existing Lambda environment values.

## 4. Application release and DNS

Read `WebBucket` from the data stack outputs. Upload only the approved `artifacts/production/web` directory under `releases/<releaseId>/` in that bucket, using the default profile and us-west-2. Never synchronize the project root, `.env`, SQLite data or the secret. Do not overwrite an existing release prefix with different bytes.

Prepare and review the `TabMirrorApplication` change set using the saved assembly, with `CertificateArn` set to the issued ARN and `ReleaseId` from the approved release manifest. Confirm the dynamic secret reference is still a reference, not plaintext. Deploy only after the secret and assets are ready.

Read `CloudFrontCnameTarget` and `DistributionId` from application outputs. Give Daniel the exact CloudFront target for a NameSilo CNAME named `tabs`. No Route 53 changes or nameserver changes are needed. Wait for CloudFront deployment and DNS propagation before testing. Confirm the SNS subscription email sent to Daniel; budget notifications are separate.

Load the production extension from `artifacts/production/extension` using Chrome's Load unpacked action. It has a stable public identity separate from the local development extension. Pair it with the production website; existing local pairing does not transfer. Keep only the intended extension actively syncing for the test.

## 5. Live acceptance

Verify these through the public hostname before marking Phase 8 complete:

- HTTPS certificate and redirect, private S3 origins, no API caching, Secure/HttpOnly session cookies, exact CSRF/origin checks and denied unauthenticated access.
- Real Google sign-in for both allowed users, rejection of another account, pairing feedback, upload and grouped browsing on an actual iPhone over cellular.
- Account isolation, duplicate upload retries, pause/recovery, revoke/delete and expired credentials. Use synthetic tabs for destructive acceptance tests.
- Confirm deletion removes API access immediately and that scheduled cleanup actually removes retired objects. Verify no private URLs, titles or credentials appear in operational logs.
- Verify alert subscription and delivery with a controlled alarm-state exercise, and confirm the budget recipient/configuration. Never induce real data loss to test an alarm.
- Rehearse code rollback and repeat sign-in, snapshot read and extension upload checks. Record evidence and outstanding limitations.

## 6. Rollback

Keep the previous approved cloud assembly, production files and manifest. Redeploy that assembly with its original release prefix and certificate parameter so the Lambda version/alias and website origin configuration revert together. CloudFront propagation is not atomic with Lambda; keep API contracts compatible across adjacent releases. Do not overwrite the current Lambda alias manually as the normal rollback procedure, because that creates infrastructure drift.

Do not restore browsing snapshots or old credentials as part of code rollback. Metadata PITR is a separate incident procedure and cannot recreate deleted S3 snapshots. Retained data resources and existing extension identity must survive a code rollback. Check CloudFormation drift and run live acceptance again. Rollback has not yet been rehearsed.
