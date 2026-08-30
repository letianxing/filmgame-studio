# Asset and Story Dependency Graph

## Current baseline

`analyzeDependencies()` maps JSON patch paths to regeneration stages, and the Production Plan creates a job DAG. This is useful but cannot express per-asset staleness or reuse.

## Hardened graph

```text
Canonical Character
  -> Costume / Voice
  -> Scene
  -> Shot
  -> Storyboard
  -> Image
  -> Video
  -> Voice / Subtitle / Music / SFX
  -> Shot Render
  -> Scene Render
  -> QA
  -> Asset Manifest
  -> Runtime Package
  -> Unreal Build
```

Nodes use stable IDs and one of:

- `UP_TO_DATE`
- `DIRTY`
- `STALE`
- `NEEDS_REGENERATION`
- `BLOCKED`

Each node stores `contentHash`, `inputHash` and `dependencyHash`. An edge declares the reason and whether the dependency is hard, quality-only, or runtime-only.

## Invalidation algorithm

1. resolve the structured patch target;
2. compare old/new canonical hashes;
3. mark directly changed nodes `DIRTY`;
4. traverse outgoing hard edges and mark prior outputs `STALE`;
5. stop at unaffected entity boundaries;
6. protect LOCKED nodes with explicit conflicts;
7. emit a preview containing affected assets/jobs/cost;
8. after approval, create only `NEEDS_REGENERATION` jobs;
9. reuse outputs whose input/dependency hashes remain equal.

Example: changing one character's coat invalidates that costume, only shots containing that character in the relevant costume interval, their downstream media/render/QA nodes, and packages containing those assets. It must not regenerate unrelated characters, locations, scenes or endings.

## Reversibility

Invalidation is metadata-only. Prior assets remain immutable and addressable by version. Restoring a prior Story/Bible version can reactivate matching cached outputs.
