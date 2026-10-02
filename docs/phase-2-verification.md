# Phase 2: foundation and local environment

Implemented 2026-09-21. This phase delivers a reproducible local preview and shared contracts. It does not capture real Chrome tabs or authenticate real accounts.

## Deliverables

- npm workspaces for web, API, extension and shared contracts; pinned Node 22 and exact dependency lockfile.
- Schema-generated TypeScript types and precompiled ES-module validator. Browser/extension consumers do not need runtime schema code generation.
- Strict JSON parser rejecting duplicate decoded keys, comments, trailing commas, deep nesting, ambiguous numeric literals, and oversized UTF-8 payloads.
- Semantic checks for URL eligibility, global tab/group limits, unique IDs, group ownership/contiguity/order, tab ordering and focus consistency.
- Synthetic mixed, empty and 1,000-tab fixtures, validated before API storage and again in the viewer.
- Read-only loopback API with explicit mock identity and memory-store boundaries. Missing configuration, production mode, nonlocal adapters and external bind addresses fail closed.
- Responsive React fixture viewer, collection switching, ordered groups/ungrouped runs, expandable windows, empty/error states and retry.
- Permissionless MV3 extension scaffold and infrastructure placeholder; capture/deployment intentionally remain later phases.
- Root setup guide, environment template, secret/output exclusions, formatting commands and GitHub CI workflow. No remote CI run has been performed.

## Verification evidence

- Final `npm run check` passed: TypeScript, 47 tests, all builds, bundled API smoke test and formatting.
- 47 tests passed: schema/semantic validation, malformed and ambiguous JSON, size boundaries, unsafe URLs, configuration rejection, real loopback HTTP routes, host/origin restrictions and memory-store owner isolation.
- All three build outputs generated successfully.
- Clean temporary copy excluded dependencies, generated contracts, output folders and `.env`; `npm ci` and the full then-current check pipeline passed. The later bundled-API check additionally validates the executable output and is now included in `npm run check`.
- Built API serves the mixed fixture. Running the bundle with `NODE_ENV=production` exits with status 1 and the explicit unsupported production-adapter message, before binding.
- Isolated desktop Chrome loaded the viewer through the Vite proxy. Mixed and empty collections rendered; the large collection reported and rendered 1,000 tabs, 20 windows and 100 groups.
- A temporary failed browser fetch displayed the API error state. Invoking the visible retry button’s handler restored the mixed fixture from the real API; browser errors/overlays were absent afterward.
- 390 × 844 viewport: no horizontal overflow. Desktop and phone-sized screenshots inspected. This is responsive desktop-Chrome verification, not an actual iPhone/Safari test.
- Browser module error discovered during verification was fixed by generating bundled ES modules; packaged API dependency-format error was fixed by preferring dependency module entries. Both are covered by the final build and browser checks.

## Phase boundary

Cloud resources, Google OAuth, production sessions, device pairing, capture/sync, persistent storage, true freshness states and full mobile browsing controls are not implemented here. Local fixtures are not evidence that those future flows work. Device and identity interfaces can be extended without exposing a production mock-auth bypass.

Next: Phase 3 desktop capture and sync engine. Phase 4 will provide the real authenticated upload/storage service; Phase 3 uses the defined integration boundary while that service is under development.
