# Canonical Bible and Consistency Model

## Source-of-truth rule

`StoryModel` remains authoritative. A backward-compatible optional `canonicalBible` aggregate will make existing implicit bibles explicit without duplicating provider-owned interpretations.

```text
StoryVersion
  -> CanonicalBibleVersion
      -> Project / World / Visual / Story Canon
      -> Character Canon
          -> Appearance / Costume / Voice locks
      -> Location Canon
      -> Prop Canon
```

Providers receive only resolved, ID-addressed production inputs derived from this aggregate. Provider output may propose metadata or validation findings, but cannot modify canonical fields.

## Canonical entities

Every canonical record has:

- stable `id` and `kind`;
- `bibleVersion` and `revision`;
- lifecycle `DRAFT -> REVIEW -> APPROVED -> LOCKED -> DEPRECATED`;
- canonical and negative constraints;
- canonical reference asset IDs;
- content hash;
- optional superseded record ID;
- approval and lock timestamps.

Character canon additionally contains face, age presentation, hair, body, accessories, injury/makeup baseline, costume IDs and voice ID. Costume, Voice, Location and Hero Prop are independently lockable records.

## Production resolution

Before creating a generative job, the Orchestrator resolves:

```text
entity IDs
+ Bible version
+ lock revisions
+ canonical references
+ prompt template/constraints
+ shot-specific intent
= ResolvedProductionInput
```

The resolved input is hashed and stored with the generation run. A LOCKED field cannot be overridden by free text, provider defaults, or a fallback provider.

## Continuity observations

The validator consumes canonical records plus ordered scene/shot facts. It emits structured observations rather than rewriting assets.

| Dimension | Required checks |
| --- | --- |
| Character | face, presented age, hair, body, costume, accessories, injury, makeup |
| Location | layout, doors/windows, furniture, scale, material, lighting, time of day |
| Prop | ownership, location, visibility, damage, consumed/lost/destroyed |
| Shot | screen direction, position, eyeline, blocking, camera and lighting direction |
| Temporal | chapter/scene order, elapsed time and state transitions |
| Voice | voice ID, speaker, language, accent/style and allowed emotion range |
| Story | knowledge, secrets, evidence, relationships, inventory, world state, alive/location/action facts |

Blocking issues prevent APPROVED/LOCKED transitions. Warnings require creator review for hero assets and key scenes.

## Migration

Existing Story `1.0.0` remains valid. When `canonicalBible` is absent, a deterministic projection derives canonical records from existing `brief`, `world`, `visualBible`, `characters`, `locations`, `inventory` and `evidence`. The projection never writes provider output back into Story state.
