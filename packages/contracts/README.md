# Snapshot contract v1

Phase 2 runtime contract. `snapshot.schema.json` is JSON Schema 2020-12 for the device upload body. `examples/mixed.json` illustrates interleaved ungrouped/grouped tabs, filtered index gaps, pinned tabs and an empty title; `examples/empty.json` intentionally clears all eligible tabs. Data is synthetic.

AJV 2020 with format assertions generates a standalone ES module at build time. TypeScript types are generated from the same schema. `src/index.ts` exports `parseSnapshot`, `validateSnapshot`, and `isEligibleUrl`; the API and browser viewer share these functions, ready for the extension in Phase 3. Strict JSON parsing uses jsonc-parser visitors to reject duplicate decoded keys and malformed input before JSON.parse. Runtime validation enforces the cross-field rules below. Run `npm test` from the repository root; the Phase 1 Python check remains historical draft verification.

## Normative semantic validation

- Body must be uncompressed application/json, at most 2,097,152 UTF-8 bytes before parsing. Require plain JSON numbers that are safe integers; reject duplicate JSON object keys at the parser boundary or use a parser that explicitly detects them.
- At most 1,000 tabs and 100 groups across all windows, not per window. Up to 20 windows. Reject excess, never truncate.
- Window IDs unique and ascending; tab IDs unique across snapshot; group IDs unique across snapshot. Tab indices strictly increasing in each window but may have gaps from filtering. At most one focused window; none is valid.
- Every non-null groupId references a group in the same window. Every group has at least one included tab; groups appear in order of first referenced tab. A group must form one contiguous run in the included tab list. Empty windows/groups are omitted; `windows: []` is valid.
- IDs are transient Chrome IDs, never authorization identities. Browser session UUID scopes UI state but not revision ordering. Revisions increase for the paired device across sessions and are bounded by Number.MAX_SAFE_INTEGER; exhaustion requires re-pairing.
- Parse URL with WHATWG URL; require HTTP or HTTPS, nonempty hostname, no username/password. Schema pattern alone is insufficient. Preserve the original committed URL for links after validation. Reject whitespace/control characters and backslashes rather than silently normalize ambiguous strings. Extension skips ineligible URLs and increments omittedTabCount, API rejects a payload containing one.
- Date-time must be a valid RFC3339 UTC instant ending Z. It is display metadata, never an ordering or freshness authority. Server receipt time is separate. No fabricated corrections for clock skew.
- String caps and total-byte limit fail the whole candidate; never cut URLs or titles. Missing native title becomes empty string. `omittedTabCount` counts only excluded tabs from normal non-incognito windows; it does not include closed/saved groups or incognito.
- Additional keys, owner IDs, device IDs, display names, server timestamps, tokens, and favicon fields are rejected. Owner/device come from bearer authentication. Display name is enrollment metadata.

The backend returns the body inside a server-owned envelope described in [architecture](../../docs/phase-1/architecture.md). Hash accepted body bytes server-side for retry equality; clients retry identical serialized bytes for a revision. Whitespace/key-order differences at the same revision are conflicts. Content-change detection on the extension uses a separate deterministic representation excluding capture time/revision.

Schema edits that break existing payloads require a new schemaVersion and coordinated rollout. Unsupported versions return an actionable update-required error without replacing existing state.
