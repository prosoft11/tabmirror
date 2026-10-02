# Phase 8 verification record

October 2, 2026. AWS hosting and alerts provisioned; hosted smoke passed. See [current hosting evidence and two-minute timing results](phase-8-hosting.md). The older local results below are historical. See [foundation evidence and DNS handoff](phase-8-foundation.md).

## Passed

- Default-profile STS identity matches account `400745793130`; no credentials displayed or copied.
- Initial read-only inventories found no TabMirror or CDKToolkit stacks. Both regions are now bootstrapped with a custom foundation-only execution policy; the data stack reached UPDATE_COMPLETE after retained-resource recovery.
- Final full local check passed all 119 tests, including the session-expiry-during-object-read regression, with type checking, local build verification and formatting. The HTTP bridge test requires permission to bind a temporary loopback port; it passed when run with that permission.
- Real Chromium synthetic-OIDC integration passed: PKCE, session cookies, CSRF, pairing persistence, automatic completion feedback, Chrome uploads, owner binding, mobile management, revoke/delete/logout. Group creation appeared in about 8.5 seconds and rename in about 7.9 seconds in that run.
- Mobile regression passed: hierarchy/search, collapse restoration, safe links, focus, freshness, pause/empty states, 1,000 tabs, storage recovery and unsafe payload rejection.
- Cloud tests cover atomic revisions, ownership, revocation/logout racing object I/O, pairing reservations and verifier failures, expiry/renewal, rate limiting and cleanup/publication races. HTTP tests cover secure renewal cookies and rejected malformed/oversized bodies. Infrastructure tests check private retained storage, secret references, cache policy, certificate region, external DNS and production packaging.
- Real AWS SDK requests passed against DynamoDB Local: transactional pairing, concurrent publication, owner queries, revoke/delete, cleanup, rate limits and logout. S3 was an in-memory test double. The temporary emulator was stopped afterward; no AWS account was accessed by this test.
- Strict CDK synthesis passed for three stacks without lookups or AWS writes.
- `npm audit --omit=dev` reported zero vulnerabilities. CDK's bundled development-only brace-expansion dependency still has a high-severity advisory; the override does not replace the bundled copy. Do not call the full dependency audit clean. Review upstream remediation before production deployment.

- Live foundation metadata checks passed: private encrypted buckets, correct versioning, active table with TTL/seven-day PITR/deletion protection, empty OAuth secret metadata and scoped execution-role attachments. Evidence is in `artifacts/foundation/verification.json`.

## Still required

Final DNS, real Google production sign-in, live paired upload/read and S3 cleanup, physical iPhone/cellular/Farris acceptance, email alarm delivery and rollback rehearsal. Local tests cannot establish those results.
