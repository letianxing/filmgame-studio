# FilmGame Studio

First-party, clean-room implementation of an AI-native 4–8 player multiplayer interactive-film studio.

Owner-only Creator Console alpha: `https://filmgame-story-studio.letianxing941118.chatgpt.site`

```text
IDEA -> DESIGN -> GENERATE -> PLAYTEST -> REFINE -> BUILD -> PUBLISH
```

## What is working

- Creator Console with Idea, Story, Production, Playtest and Publish surfaces.
- SIWC-aware project API with D1 persistence and R2 asset boundary.
- Versioned Story Model, Production, Runtime Package and Asset Manifest JSON Schemas.
- Natural-language change proposals, immutable Story Versions, dependency analysis and Asset Lock conflicts.
- Specialist story generation workflow: Producer, Narrative Designer, Character Writer, Multiplayer Designer and Script Writer.
- Development-only Codex CLI LLM adapter using the current signed-in session; a real run produced a validated 6-player, 17-scene, 9-ending Story Model.
- Per-scene Director workflow producing shot-level storyboard/image/video/TTS/subtitle/render/QA DAGs.
- Provider-neutral LLM, image, video, TTS, music, SFX and storage contracts.
- ComfyUI image/video adapter, CosyVoice TTS adapter and deterministic FFmpeg media pipeline.
- Verified FLUX storyboard generation, installed/hash-pinned Wan2.2 model set, and enforced local resource admission with automatic interruption.
- Immutable streaming asset storage, shot render → scene assembly → QA, four-target Runtime Package and release gates.
- Authoritative Colyseus story room with role assignment, private state, action authorization, deterministic resolution, reconnect, host election, Bot takeover, snapshots and event logs.
- Mobile Companion Web client using `@colyseus/sdk`.
- First-party Unreal JSON/WebSocket Gateway plus UE 5.7.4 C++ runtime client source.
- Verified UE 5.7.4 Editor and Shipping builds, headless map load, BuildCookRun, Pak/IoStore archive and packaged NullRHI launch.
- Development fixtures for Snowbound Hotel Story, Production, Runtime Package and Asset Manifest.

## Truthful capability status

The control plane and vertical slice run locally. Real long-form media generation is not claimed until providers
are configured and their outputs pass QA. Missing videos are represented as `MISSING` assets and block Publish.

Current external/commercial gates:

- supply an API key or workload identity for hosted production LLM calls; local development can use the bounded Codex CLI adapter;
- configure a capacity-admitted VideoProvider (local Wan is intentionally blocked on this workstation);
- complete voice-reference rights review for commercial production;
- provide signing/Steam publisher credentials and complete store QA;
- complete commercial license review and release SBOM.

## Local development

Requirements: Node.js 22.13+, npm, and the machine configuration described in `.env.example`.

```powershell
# Validate contracts, types, lint, tests and production builds
npm run check

# Creator Console
npm --prefix apps/creator-console run dev

# Companion Web
npm --prefix apps/companion-web run dev

# Multiplayer server + Unreal gateway
npm --prefix apps/multiplayer-server start

# Story/production orchestrator
npm run start:orchestrator
```

Default local endpoints:

| Surface | URL |
| --- | --- |
| Creator Console | `http://127.0.0.1:3000` |
| Companion Web | `http://127.0.0.1:3001` |
| Colyseus | `ws://127.0.0.1:2567` |
| Unreal Runtime Gateway | `ws://127.0.0.1:2568` |
| Orchestrator | `http://127.0.0.1:4100` |
| ComfyUI | `http://127.0.0.1:8188` |
| CosyVoice | `http://127.0.0.1:50000` |

## Verification

```powershell
npm test
npm run test:integration
npm run smoke:media
```

The integration tests connect real SDK clients to Colyseus and the Unreal Gateway. `smoke:media` creates an
actual MP4, thumbnail and ffprobe report through `MediaPipeline`.

## Repository boundaries

`filmgame-studio` is the commercial source of truth. Sibling repositories and local installations are upstream
dependencies or references. In particular, `../filmgame` prohibits commercial use without written authorization;
none of its implementation is copied here.

See `docs/ARCHITECTURE.md`, `docs/REPO_AUDIT.md`, `docs/IMPLEMENTATION_STATUS.md`,
`docs/LOCAL_RESOURCE_POLICY.md`, `docs/REMOTE_MEDIA_CONTRACT.md` and
`docs/UNREAL_LAUNCHER_RECOVERY.md`. Unreal build evidence is in
`docs/UNREAL_BUILD_REPORT.md`.
