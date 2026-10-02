# Phase 1 deliverables

Completed 2026-09-21: requirements and acceptance matrix, architecture/feasibility decisions, privacy/authentication design, and a versioned snapshot schema draft with synthetic examples.

- [Requirements and acceptance](requirements.md): 19 traceable acceptance items, scope, limits, unresolved inputs.
- [Architecture and API](architecture.md): capture, ordering, revisions, persistence, recovery, endpoint contracts and official references.
- [Privacy and authentication](security.md): identity, renewable sessions, pairing, credential scope, retention and negative tests.
- [Snapshot contract](../../packages/contracts/README.md): structural schema and required semantic validation.
- [Schema](../../packages/contracts/snapshot.schema.json), [mixed example](../../packages/contracts/examples/mixed.json), [empty example](../../packages/contracts/examples/empty.json).

Phase 1 exit: every current requirement maps to implementation/verification or an explicit limitation. Local development is unblocked. Google account allowlist, AWS access, OAuth ownership, domain, and physical-device testing remain later-phase inputs. Profile-dependent iPhone login extension is not established; a sliding session is the proposed alternative, not an accepted fulfillment of that literal requirement.

Validation status: see verification.md. No extension, server, login, infrastructure, or actual-device flow has been implemented or validated in Phase 1. Next is Phase 2 foundation.
