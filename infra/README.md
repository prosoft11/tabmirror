# AWS production candidate

October 2, 2026: the asynchronous DynamoDB/S3 backend, Lambda HTTP bridge, production packaging and three CDK stacks are implemented and locally verified. **The AWS foundation is provisioned; application hosting and live production verification remain pending.** The SQLite development bootstrap still refuses production mode.

- `npm run aws:preflight`: read-only account gate and relevant stack inventory, using only the default profile. Stops on failure or account mismatch.
- `npm run infra:synth`: builds production artifacts and strictly synthesizes infrastructure without lookups or provisioning.
- `npm run test:cloud`: cloud storage race, HTTP bridge and infrastructure tests.
- `production-settings.json`: Daniel's non-secret deployment inputs.
- `extension-identity.json`: stable public identity for the unpacked production extension. Preserve this file; it contains no private signing key.
- `app.ts`: certificate in us-east-1; retained data and application infrastructure in us-west-2.

See [deployment status and design](../docs/phase-8-deployment.md), [operator runbook](../docs/phase-8-runbook.md), [verification evidence](../docs/phase-8-verification.md), and the [foundation/DNS handoff](../docs/phase-8-foundation.md). DNS remains at NameSilo under Daniel's control. Never change the existing apex or www records. Never read the OAuth secret into agent output.
