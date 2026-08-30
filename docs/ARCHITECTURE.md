# FilmGame Studio Architecture

## Product flow

```text
IDEA -> DESIGN -> GENERATE -> PLAYTEST -> REFINE -> BUILD -> PUBLISH
```

The creator works in one visual console. Natural-language commands become proposed structured changes, not
unreviewed chat output.

```text
Natural language command
  -> intent + target resolution
  -> proposed patch
  -> schema validation
  -> dependency analysis
  -> preview / approve
  -> immutable StoryVersion
  -> selective regeneration plan
```

## Bounded systems

| System | Owns | Must not own |
| --- | --- | --- |
| Story Studio | projects, story versions, narrative entities, authoring commands | provider-specific execution |
| Story Engine | validation, dependency graph, patch proposals, versioning | multiplayer session state |
| Production Orchestrator | workflow DAGs, jobs, retries, costs, provider selection | story authoring UI |
| Provider Layer | normalized LLM/image/video/TTS/music/SFX/storage calls | domain policy |
| Asset Pipeline | asset locks, manifests, rendering and provenance | authoritative player state |
| Multiplayer Runtime | rooms, role authorization, state, timers, resolution, snapshots, events | free-form AI mutation |
| Companion Web | role-private view and intent submission | resolution decisions |
| Unreal Client | cinematic playback, lobby, runtime presentation | authoring and production |

## Authoritative-state rule

Only the multiplayer server may commit runtime mutations. The sequence is always:

```text
client intent -> authentication/role authorization -> schema validation
-> deterministic resolution rules -> atomic state mutations -> event log -> state broadcast
```

LLMs and realtime agents may classify or propose an intent. Their output is untrusted input to the same path.

## Contract rule

The JSON Schemas in `packages/*-schema` are the cross-system contracts. Provider metadata is preserved for
auditability, but provider names and model-specific parameters do not leak into core story or runtime models.

## V1 media rule

Main-film scenes are generated before play, validated, stored and packaged. Player actions resolve immediately
to an already available scene or deterministic fallback. Runtime generation is optional future content only.

