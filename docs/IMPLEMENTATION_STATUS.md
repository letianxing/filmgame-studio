# Implementation status

Updated: 2026-08-30

## Production hardening update - 2026-08-31

- Added Canonical Bible projection, five-state Asset Lock lifecycle and multi-domain Continuity validation.
- Added per-job input/dependency hashes, selective dependency invalidation preview and stable retry idempotency.
- Added durable Production Run snapshots with interrupted-worker recovery and durable Runtime event/snapshot files with hash-verified replay.
- Restricted Bot inputs to role knowledge and made bot-fill host-authorized.
- Added Provider capability selection, retry/timeout/circuit breaker and contract-preserving Video fallback.
- Added preflight workload/cost estimates, retry reserve and max-budget pause before provider calls.
- Added complete generation provenance records and fail-closed commercial license/provenance gates.
- Added FFmpeg technical validation, black/silence review signals, participation heatmaps and creator-actionable failures.
- Added a 4-player Golden Project and expanded the automated suite from 42 to 67 tests before final acceptance runs.

Legend: **Implemented** means source plus proportionate automated verification exists. **Contract** means the
formal model/boundary exists but a real external provider or final production implementation is not yet verified.

| Area | Status | Evidence / remaining gate |
| --- | --- | --- |
| Project Brief / World / Tone / Visual Bible | Implemented | Story Schema + specialist Story Workflow + fixture |
| Characters / profiles / secrets / goals / victory | Implemented | Story Schema, sample story, semantic validator |
| Relationships / evidence / inventory / locations | Implemented | Story Schema and validated fixture |
| Chapters / story graph / scenes / endings | Implemented | Reachability and reference validation |
| Role actions / resolution / state mutations | Implemented | Server-only Resolution Engine and tests |
| Story version / change preview / dependency analysis | Implemented | Story Engine tests include version conflicts and locked assets |
| Story command UI / apply / rollback | Implemented | Creator API persists proposals in D1, previews Patch/dependencies, applies immutable versions, and rolls back by creating a new version |
| Story and multiplayer balance validation | Implemented baseline | Reachability, references and role action participation; deeper simulation remains |
| Script and dialogue generation | Implemented + locally verified | Development Codex CLI provider generated a schema-valid 6-player story through all five specialist nodes; production uses the API provider boundary |
| Director treatment / shot lists | Implemented workflow | Production fixture covers 2 scenes + 6 endings, BGM and shot SFX in a 104-job validated DAG |
| Storyboard / image | Implemented local provider | FLUX.1 Schnell FP8 generated and visually verified a real 768×432 storyboard; hash recorded |
| Video | Implemented contract + installed local candidate | Wan2.2 workflow and weights verified by size; local automatic admission is disabled after Windows virtual-memory exhaustion; configure another VideoProvider or qualify on a larger machine |
| Character / location consistency | Implemented contract | DRAFT→APPROVED→LOCKED plus dependency conflicts; visual QA model remains |
| Voice | Implemented | CosyVoice2 CUDA inference and first-party HTTP `TTSProvider` smoke passed; voice-reference rights remain a release gate |
| Subtitle | Implemented | Deterministic per-shot SRT handler, immutable storage, and tests |
| Music / SFX | Implemented remote contract + DAG | Stable submit/poll providers, immutable asset handlers and FFmpeg mixing; upstream service credentials remain |
| Remote media / storage | Implemented first-party contracts | Video, music, SFX and object storage submit/poll/upload boundaries have mock-server integration tests |
| Production cost / audit | Implemented baseline | Provider usage/model/request metadata, estimated cost rollup, and serialized JSONL job audit events |
| FFmpeg final render | Implemented | LGPL CLI installed; video/voice/subtitle final-scene handler plus video/thumbnail/probe smoke |
| Immutable asset storage | Implemented local + remote contracts | Streaming writes/uploads, SHA-256 receipts, traversal protection, idempotent retries, signed reads, and tests |
| Asset Manifest | Implemented contract | Fixture validates; real media assets intentionally marked MISSING |
| Multiplayer runtime package | Implemented | First-party deterministic packager, four target entries, immutable runtime definition, and versioned directory loader |
| Colyseus room / reconnect / Bot / event log | Implemented | SDK and gateway smoke tests pass |
| LiveKit speech intent boundary | Implemented V1 contract | Realtime bridge returns non-authoritative Intent Candidates; server rule engine remains state owner |
| Companion client | Implemented vertical slice | Production build passes |
| Playtest room / mobile join | Implemented vertical slice | Creator API creates real Colyseus rooms; QR links carry room/project/runtime into Companion |
| AI Bot playtest / analytics | Implemented baseline | Bounded deterministic path exploration, ending coverage, role action counts, D1 reports, and Creator UI; richer combinatorial coverage remains |
| Unreal Runtime Client | Implemented buildable shell | Editor/Shipping compile, headless load, Cook, Pak/IoStore, Archive and packaged launch smoke pass |
| Unreal Runtime Gateway | Implemented | Real WebSocket bridge smoke passes |
| Creator Console | Implemented vertical slice + private alpha | Natural-language one-click dispatch, Story sync/versioning, Production DAG sync/run gate, Playtest room QR, dynamic Publish gates, D1/R2, lint/build; owner-only Sites deployment live |
| Build / Publish | Implemented local build + gates | UE Shipping archive passes; approved real media, SBOM completion, signing and store release remain commercial gates |

The complete 104-job production DAG also passes a controlled end-to-end test through reference generation,
all media providers, voice/music/SFX mixing, scene assembly, QA, every ending, four runtime targets and audit.
This proves orchestration behavior, not that unconfigured external providers have produced commercial assets.

## Remaining external / commercial gates

1. Development story generation is configured through the existing Codex CLI session and has produced a formally validated 6-player story with 17 scenes and 9 endings. A commercial hosted deployment still needs an API key or workload identity; CLI session authentication is never extracted or shipped.
2. Local Wan2.2 video is not admitted on this workstation under representative load; another VideoProvider or a larger committed-memory budget is required.
3. Commercial voice-reference consent and provenance must be tracked per character.
4. Steam signing/store configuration and release QA require publisher credentials; the local Win64 Shipping archive itself builds and launches successfully.
5. The Creator Console private alpha is hosted; externally reachable Orchestrator/Colyseus/Provider services are still required for hosted generation and playtest.

The real Codex CLI story run completed all five specialist nodes without retry. Deterministic validation returned
`valid=true`; its only findings were two non-blocking participation-balance warnings, which remain visible for
creator refinement rather than being silently discarded.

Epic Launcher registration has been recovered. Launcher reports UE 5.7.4 installed at
`G:\Epic Games\UE_5.7`, and an Epic protocol launch smoke opened the verified UnrealEditor executable. See
`UNREAL_LAUNCHER_RECOVERY.md`.
