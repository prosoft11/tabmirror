# Foundation provisioning record

**Current status: foundation provisioned and metadata verification passed. Certificate DNS validation and production OAuth entry are pending.**

Daniel authorized foundation provisioning on October 2, 2026. STS rechecked account 400745793130 using the default profile before mutations. No DNS or OAuth values are managed by the agent.

## Reviewed scope

CDKToolkit in us-west-2 and us-east-1 supplies deployment/asset roles, an asset S3 bucket, empty ECR repository and bootstrap version parameter. Termination protection is enabled; no cross-account trust is configured.

The custom `infra/bootstrap-foundation.yaml` replaces the CloudFormation execution role's managed-policy attachment with an inline `TabMirrorFoundationOnly` policy. It manages TabMirrorData-prefixed buckets/table, the one OAuth secret and the tabs.portuit.com certificate request. It has no secret-value read permission or AdministratorAccess attachment. CDK prints a generic default-policy message, but this custom template does not use that parameter for the execution role.

TabMirrorData creates private retained S3 buckets, on-demand DynamoDB with TTL and seven-day PITR, and an empty retained OAuth secret. TabMirrorCertificate requests a retained non-exportable public certificate in us-east-1 with external DNS validation. No browsing data is uploaded by provisioning.

Application hosting and operational alarms are not part of this foundation apply. The application stack needs a separately reviewed execution-policy extension and Daniel's DNS/OAuth handoff. No automatic privilege broadening or user-policy changes are permitted.

## Foundation cost basis

Checked October 2, 2026: [Secrets Manager](https://aws.amazon.com/secrets-manager/pricing/) lists $0.40 per secret-month plus request charges; [non-exportable public ACM certificates](https://aws.amazon.com/certificate-manager/pricing/) have no separate certificate charge. Empty on-demand data stores do not reserve throughput. S3/bootstrap objects, DynamoDB storage/PITR and service requests are usage-priced. No free allowances are assumed. This is the foundation cost basis, not a full application monthly estimate; that remains required before hosting deployment. The $10 account-wide budget is an alert, not a cap.

## State

The us-west-2 bootstrap completed. Automatic review rejected us-east-1 bootstrap over a suspected AdministratorAccess attachment. AWS subsequently confirmed AttachedPolicies=[] and only the scoped TabMirrorFoundationOnly inline policy; review accepted the retry. Exact resource outputs will be recorded after AWS returns them. Secret values will never be recorded here.

The first data change-set preparation failed because the execution role could not read the bootstrap version marker. No TabMirrorData stack existed afterward. The policy was amended only with `ssm:GetParameters` on `/cdk-bootstrap/hnb659fds/version` in the two target regions.

## Certificate DNS handoff

Certificate ARN: `arn:aws:acm:us-east-1:400745793130:certificate/888c7aa3-07e2-47e9-b052-455e03cfd154`.

AWS returned PENDING_VALIDATION. In NameSilo's portuit.com zone add:

| Type  | Host                                     | Value                                                              |
| ----- | ---------------------------------------- | ------------------------------------------------------------------ |
| CNAME | `_7876bee824266161f0c67492a80400eb.tabs` | `_0ab34f988a21a4e953f7d42a966b29c8.wzccmgtwzk.acm-validations.aws` |

Full record name: `_7876bee824266161f0c67492a80400eb.tabs.portuit.com.` Keep this record for certificate renewal. The CloudFront `tabs` CNAME will be supplied after application deployment; it is not yet available.

## Recovery notes

The first data stack execution rolled back because its scoped role lacked S3's separately named `PutEncryptionConfiguration` permission. Four resources were retained (DELETE_SKIPPED). Only the failed stack record was removed; import reattaches the same resources, followed by an update to complete encryption, public-access blocks, versioning, TTL and PITR configuration. The role now includes the matching Get/PutEncryptionConfiguration actions restricted to TabMirrorData-prefixed buckets. No user IAM policy was changed and no data resources were intentionally deleted.

## OAuth handoff

Open [the production secret in us-west-2](https://us-west-2.console.aws.amazon.com/secretsmanager/secret?name=tabmirror%2Fproduction%2Fgoogle-oauth&region=us-west-2). Store a JSON object with string keys `clientId` and `clientSecret`, using the separate production Google client. The callback must be `https://tabs.portuit.com/api/auth/callback`. Keep both values out of chat and repository files. Metadata initially showed no stored versions; the agent never fetched a secret value.

Resource ARN: `arn:aws:secretsmanager:us-west-2:400745793130:secret:tabmirror/production/google-oauth-KCeRHP`.

Retained-resource import completed successfully and termination protection was restored. The final configuration update is being applied using the scoped execution role. Resource-provider read/tag permissions were verified from AWS's S3 CloudFormation schema and added only for TabMirrorData bucket ARNs.

## Deployment outcome

`TabMirrorData` reached `UPDATE_COMPLETE` with termination protection enabled. Both CDKToolkit stacks completed. The certificate is `PENDING_VALIDATION`; its stack remains in progress until Daniel adds the CNAME. No CloudFront distribution, Lambda/API hosting, operational alarms or budget alert has been deployed yet.

| Resource                | Physical identifier                            |
| ----------------------- | ---------------------------------------------- |
| Metadata table          | `TabMirrorData-MetadataBDB8F4DB-1WKX17S5K6JSY` |
| Snapshot bucket         | `tabmirrordata-snapshotsd03d071c-lf6ufesz18cc` |
| Website releases bucket | `tabmirrordata-webassets27872646-odbdb9wigark` |

The installed east-region execution policy has the certificate and bootstrap-marker permissions. The west-region version additionally includes the S3 encryption/read/tag permissions needed during recovery. Both have zero managed-policy attachments; neither grants AdministratorAccess. Keep the custom bootstrap variant on later updates.

Final `scripts/verify-foundation.mjs` passed all checks: both buckets private/AES256, snapshots unversioned, web assets versioned, table ACTIVE/on-demand/deletion-protected with enabled ttl and seven-day PITR, OAuth secret has no current version, and both execution roles have zero managed-policy attachments. Non-secret evidence is saved in `artifacts/foundation/verification.json`. No secret values or browsing data were read.
