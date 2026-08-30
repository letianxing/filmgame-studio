# Commercial Readiness Gates

## Current position

The control plane and local vertical slice are implemented. Commercial release is not equivalent to successful generation. Publish requires validated story/runtime state, approved assets, complete provenance, a reproducible build and external publisher credentials.

## Mandatory release gates

| Gate | Current | Required for commercial RC |
| --- | --- | --- |
| Story/schema/graph | Baseline implemented | no ERROR issues; all endings reachable and conditions/mutations valid |
| Multiplayer balance | Baseline implemented | no blocking information starvation/passive/overpowered role finding |
| Canonical continuity | Missing | hero characters/locations/props and key scenes pass or have signed override |
| Asset quality | Partial | technical + consistency validation and APPROVED/LOCKED status |
| Provenance | Partial | source, provider/model/license, references and commercial status for every asset |
| License | Partial | block UNKNOWN, NON_COMMERCIAL, RESTRICTED and MISSING_PROVENANCE |
| Voice rights | External/partial | ACTIVE VoiceGrant per cloned/reference voice |
| Runtime replay | Partial | deterministic replay and reconnect acceptance pass |
| Budget/audit | Partial | actual cost within approved limit; complete run audit |
| Unreal package | Implemented locally | manifest/version compatibility, signed Shipping package and clean-machine test |
| Steam | External | publisher onboarding, App/Depot, review and release QA |

## Provenance vocabulary

Source: `GENERATED | HUMAN | LICENSED | DERIVED | BUILT`.  
Commercial status: `UNKNOWN | REVIEW_REQUIRED | APPROVED | NON_COMMERCIAL | RESTRICTED | EXPIRED`.

Every derived asset inherits all upstream restrictions. An override cannot turn a non-commercial reference into an approved commercial derivative without new license evidence.

`../filmgame` is permanently `REFERENCE_ONLY` unless a separately recorded commercial grant exists. Its code and assets must never appear as production provenance by accident.

## Release evidence

The release manifest binds:

- Story/Bible/Prompt/Workflow/Production/Runtime/Build versions;
- content/input/dependency hashes;
- asset provenance and approvals;
- provider generation records and cost;
- QA findings and human overrides;
- build artifact hashes, signature identity and timestamp.

Any missing evidence blocks Commercial Release Candidate by default.

## Final acceptance evidence

| Scenario | Automated evidence |
| --- | --- |
| A - One-click Creation | `apps/orchestrator/test/golden-path.e2e.test.ts` runs the 4-player Golden Project through Story/Canon validation, Production DAG, assets, bot playtest and Unreal-readable Runtime Package. |
| B - Character Modification | Story Engine parses “把女主外套改成黑色”, targets one character, detects lock conflicts and Dependency Graph invalidates only that branch plus shared packages. |
| C - Provider Failure | Provider SDK retries the primary, opens a circuit when required and falls back only to a capability-compatible VideoProvider. |
| D - Orchestrator Crash | File Run Store test restores an interrupted Shot 300 frontier while preserving completed Shot 1 output. |
| E - Multiplayer Disconnect | Real Colyseus SDK smoke forcibly drops the connection, automatically reconnects, restores the journalist role/private state and continues at the same scene. |
| F - Private Information | RoleKnowledge projection test proves role A cannot contain role B's marker; Companion private requests are session-role bound. |
| G - Story Contradiction | Continuity Engine detects conflicting mutation/resolution, missing references/actions, timeline contradiction and closed loops. |
| H - Asset Inconsistency | Locked character/location/voice records without canonical references fail Continuity validation. |
| I - Budget Limit | Scheduler test pauses the next provider job before the approved maximum plus retry reserve is exceeded. |
| J - Commercial Publish | Release Engine blocks UNKNOWN, NON_COMMERCIAL, RESTRICTED, EXPIRED, missing provenance/reference/model licenses and reference-only filmgame sources. |

Verification completed on 2026-08-31:

- `npm run check` - PASS;
- 67 unit/contract/Golden tests - PASS;
- real Colyseus reconnect smoke - PASS;
- real Unreal WebSocket gateway smoke - PASS;
- real FFmpeg media smoke - PASS;
- packaged Unreal executable launch smoke - PASS.
