# Phase 1 verification record

Date: 2026-09-21. Scope: specifications and draft contract, not a running product.

## Completed

- Reviewed the source task, comments, approved requirements, and supplied proposal; mapped requirements R01–R19 to later-phase evidence or an explicit limitation.
- Checked official Chrome API, worker/alarms, Google OIDC, cookie-limit, and AWS item-limit documentation; source links accompany decisions.
- Validated schema against JSON Schema Draft 2020-12 using Python jsonschema 4.26.0 with format checks enabled in an isolated temporary environment.
- Both synthetic examples pass structural validation and example-level aggregate, reference, ordering, and URL checks.
- Twelve deliberately invalid mutations are rejected: owner injection, schema version, timestamp, UUID, zero revision, unsafe integer, unsupported URL, unexpected tab property, empty included window, excess windows, unknown group color, oversized title.
- Verified local document links and reviewed cross-document decisions for consistent limits, scope, endpoint ownership, sessions, and ordering.

Reproduce contract checks using Python with `jsonschema[format]==4.26.0` installed:

```sh
python packages/contracts/checks/validate_draft.py
```

Observed: `PASS: Draft 2020-12 schema; 2 valid examples; 12 invalid-payload checks; example aggregate/reference/order/URL checks`.

This check script is a phase-specific draft verification aid, not the application validator or comprehensive semantic test suite. Phase 2 must implement runtime validation and negative tests for global limits, duplicate IDs, malformed URLs and other cross-field constraints. Production applications must not rely on schema pattern/format checks alone.

## Remaining evidence

No actual Chrome extension capture, mobile browser test, OAuth exchange, AWS deployment, performance measurement, retention cleanup, or end-to-end security test has run. Those remain in their assigned phases. A year of cookie persistence is not observed or guaranteed. The profile-dependent iPhone login behavior remains an unresolved product requirement with a proposed sliding-session alternative.

Phase 1 exit criteria are satisfied: implementation contracts exist, requirements are traceable, feasibility limitations are recorded, and local foundation work needs no cloud credentials.
