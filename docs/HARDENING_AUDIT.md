# Production Hardening Audit

Date: 2026-08-31  
Scope: current `filmgame-studio` first-party source at commit `fdd6e14`  
Method: READ -> AUDIT -> GAP ANALYSIS. No redesign is proposed; all remediation is incremental and contract-preserving.

## Executive result

The repository already contains a credible vertical slice: natural-language story generation and versioned changes, formal schemas, a recoverable-in-process DAG, provider adapters, immutable storage, deterministic server-side resolution, a Colyseus room, bot playtest, Companion and Unreal runtime contracts, media assembly, and baseline commercial gates.

Production readiness is blocked by four P0 risks and several P1 gaps:

1. production and runtime recovery state is still in memory;
2. runtime events are insufficient for deterministic replay and the default event store is volatile;
3. BotService receives authoritative state rather than a role-scoped knowledge view;
4. commercial provenance is represented by an optional approval boolean rather than explicit source/license states.

## Status matrix

| Area | Result | Severity | Evidence | Gap / action |
| --- | --- | --- | --- | --- |
| Natural-language primary workflow | PASS | P1 | Creator APIs, Story Workflow, change proposal/apply/rollback | Preserve; add injection boundary tests and structured error catalog. |
| Structured Story source of truth | PASS | P0 | Story Schema + immutable StoryVersion records | Preserve and extend with optional canonical Bible versions. |
| LLM cannot mutate runtime state | PASS | P0 | Resolution Engine owns mutations; clients submit action intents | Preserve. |
| Canonical Project/World/Visual Bible | PARTIAL | P1 | `brief`, `world`, `narrativeTone`, `visualBible` exist | No single versioned canonical aggregate or explicit canon hash. |
| Character Bible | PARTIAL | P1 | appearance/face/hair/body/costume/voice + AssetLock | Costume and voice are embedded strings, not independently lockable/versioned. |
| Location Bible | PARTIAL | P1 | Location visual/constraints + AssetLock | No layout/door/window/material/scale structured continuity fields. |
| Prop Bible | MISSING | P1 | inventory/evidence exist as narrative objects | No hero-prop visual/ownership/damage/consumed canon. |
| Costume Bible | MISSING | P1 | one `visual.costume` string per character | No scene/time variant, lock, continuity or reference IDs. |
| Voice Bible / VoiceGrant | PARTIAL | P0 | voice binding exists; TTS enforces binding | No character-level rights evidence/status/expiry gate. |
| Asset Lock lifecycle | PARTIAL | P1 | DRAFT/APPROVED/LOCKED and conflict detection | Missing REVIEW/DEPRECATED; granularity limited to Character/Location. |
| Locked provider inputs | PARTIAL | P1 | reference jobs depend on character/location IDs | downstream shot image/video requests do not preserve all canonical references and lock revision metadata. |
| Continuity validator | MISSING | P1 | Story reference/reachability validation only | Add structured character/location/prop/shot/temporal/voice/story checks. |
| Story dependency analysis | PARTIAL | P1 | changed paths -> stages/entity IDs | coarse stage fan-out; no explicit node graph, dependency hash, Dirty/Stale state. |
| Selective regeneration | PARTIAL | P1 | proposal returns affected stages | Orchestrator always constructs full plan; no selective job invalidation API. |
| Generation provenance | PARTIAL | P1 | provider/model/request/usage and asset SHA-256 | missing resolved prompt, prompt/workflow/model versions, input/dependency hashes, parameters and attempt record as one canonical run. |
| Provider capability registry | MISSING | P1 | Provider interfaces exist | no capability negotiation; planning assumes features. |
| Provider fallback/reliability | MISSING | P1 | retries exist at JobGraph level | no fallback chain, timeout policy, circuit breaker or rate/concurrency policy per provider. |
| Production DAG | PASS | P1 | 104-job graph and scheduler tests | keep architecture. |
| Durable job recovery | MISSING | P0 | JobGraph and server job maps are memory-only | persist snapshots after transitions; recover RUNNING as RETRYING/READY. |
| Job state richness | PARTIAL | P1 | PENDING/READY/RUNNING/SUCCEEDED/FAILED/CANCELLED/BLOCKED | add WAITING/RETRYING/STALE/PAUSED plus progress, heartbeat and timestamps. |
| Job idempotency | RISK | P1 | providers receive idempotency keys | key includes `attempt`, so retry can create a new billable generation. |
| Output reuse | MISSING | P1 | immutable storage verifies content | no inputHash/provider/model/workflow cache lookup before invocation. |
| Cost estimate / budget | PARTIAL | P1 | usage and estimated cost roll-up displayed | no preflight estimate, retry reserve, maxBudget or automatic PAUSE. |
| Quality gate | PARTIAL | P1 | QA job and release requires APPROVED/LOCKED | current QA is mainly technical; consistency score/human review policy incomplete. |
| Story graph validation | PARTIAL | P1 | missing refs, reachability, ending reachability | missing loop feasibility, condition/mutation contradictions, knowledge/timeline/dead-role/prop checks. |
| Multiplayer balance | PARTIAL | P1 | action counts + bot path report | no private info/decision/influence/idle-time heatmap or warning taxonomy. |
| Runtime contract | PASS | P0 | runtime schema + deterministic packager + server loader | preserve. |
| Reconnect / host independence | PASS | P0 | reconnect, host election and Bot takeover | add durable room restore. |
| Event sourcing / replay | PARTIAL | P0 | events and snapshots exist | store is memory-only; events omit player/session, before/after hashes and rule ID on all critical transitions. |
| Bot knowledge isolation | RISK | P0 | deterministic bot currently picks first action | interface receives full `RuntimeGameState`; future AI bot could cheat. |
| Player private information isolation | PASS | P0 | private state sent from session-bound role; action authorization server-side | add adversarial API tests for role B secret requests. |
| Prompt injection boundary | PARTIAL | P0 | player free text is never interpreted as mutation | Creator LLM input lacks explicit untrusted-data framing and patch allowlist tests. |
| Asset provenance | PARTIAL | P0 | manifest source/provider/license fields | license status vocabulary and reference-license chain absent. |
| Commercial license gate | PARTIAL | P0 | missing approval blocks release | distinguish UNKNOWN/NON_COMMERCIAL/RESTRICTED/MISSING_PROVENANCE; explicitly block reference-only filmgame. |
| Large asset storage | PASS | P1 | local/remote streaming StorageProvider; metadata only in DB | preserve. |
| Asset hashes | PARTIAL | P1 | SHA-256 content hash | inputHash and dependencyHash absent. |
| Versioning | PARTIAL | P1 | Story/Production/Runtime/Manifest versions | Bible/Prompt/Workflow/Asset/Build versions not consistently bound into manifest. |
| Environment isolation | PASS | P1 | paths and credentials injected; examples only | keep regression scan for hardcoded machine paths. |
| Unreal data-driven contract | PASS | P1 | runtime package/manifest loader and WebSocket gateway | add manifest provenance/version compatibility rejection tests. |
| Media technical validation | PARTIAL | P1 | ffprobe, mux, normalize, subtitle, thumbnail | add declared codec/FPS/aspect/audio/silence/black-frame policy checks. |
| Observability | PARTIAL | P2 | progress/status/cost surfaces and JSONL audit | no heartbeat, ETA, provider circuit state or durable log correlation. |
| Failure UX | PARTIAL | P2 | UI exposes failure text | provider/FFmpeg/CUDA errors are not consistently translated into creator actions. |
| Human override | PARTIAL | P1 | version rollback and asset locks | upload/replace/provider selection/force regenerate/skip/approve/reject APIs incomplete. |
| Auto vs Review mode | MISSING | P2 | one-click flow exists | explicit shared-pipeline approval checkpoints absent. |
| Scale to 8/100/500 | RISK | P1 | schemas permit 8 and DAG supports many jobs | in-memory maps, full-array scans and no durable workers are the practical limit. |
| Automated tests | PARTIAL | P1 | 42 focused tests + integration/build smokes | missing recovery, fallback, replay, continuity, budget, injection and golden E2E scenarios. |
| Golden Path E2E | PARTIAL | P0 | Snowbound fixture and full production test | fixture is 6-player/large; no small canonical 4-player one-click regression covering A-J. |

## Implementation order

### P0

1. durable production job snapshots and restart recovery;
2. durable runtime event/snapshot store and deterministic replay hashes;
3. role-scoped Bot knowledge contract;
4. explicit provenance/license statuses and publish blockers;
5. small Golden Project with private-information and commercial-gate acceptance tests.

### P1

1. canonical Bible aggregate and complete Asset Lock lifecycle;
2. continuity validator and dependency graph with hashes/staleness;
3. provider capabilities, fallback/circuit policy and stable idempotency;
4. cost estimation/budget pause;
5. richer story/balance/media validation and selective regeneration.

## Non-goals

- no rewrite of Story Studio, Colyseus, Provider adapters, schemas or Unreal client;
- no Kubernetes, distributed message broker, or new database platform;
- no direct changes to upstream repositories;
- no claim that real provider media quality is validated without billable production runs.

## Remediation completed in this hardening pass

The initial findings above are intentionally preserved as the audit baseline. The following gaps were remediated incrementally after the audit:

- durable atomic Production Run snapshots, restart recovery and completed-output reuse;
- WAITING/RETRYING/STALE/PAUSED states, heartbeat/progress/timestamps and stable input hashes;
- provider idempotency keys no longer include attempt number;
- file-backed Runtime events/snapshots, corrected event sequence numbering and hash-verified replay;
- role-scoped Bot knowledge projection and host-only bot-fill permission;
- explicit asset provenance and commercial statuses with fail-closed release gates;
- optional backward-compatible Canonical Bible projection and complete Asset Lock lifecycle;
- continuity checks for character/voice/location references, ownership, information boundaries, timeline, mutation references, resolution and simple infinite loops;
- production dependency graph with entity-scoped invalidation preview;
- provider capability registry plus retry/timeout/circuit/fallback Video chain;
- preflight production unit/cost estimate, retry reserve and budget PAUSE before provider invocation;
- generation records with prompts, versions, references, hashes, parameters, attempt, cost and output asset;
- media stream/codec/resolution/FPS/aspect/audio/duration validation plus black/silence review signals;
- multiplayer participation heatmap and balance warnings;
- Creator/player prompt-injection boundaries and creator-friendly failure actions;
- a 4-player Golden Project and A-J focused acceptance tests.

Remaining non-code gates are real provider billable quality qualification, voice/legal evidence, signing/Steam credentials and clean-machine release QA.
