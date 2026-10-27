# FilmGame Studio

First-party, clean-room implementation of an AI-native 4–8 player multiplayer interactive-film studio.

Owner-only Creator Console alpha: `https://filmgame-story-studio.letianxing941118.chatgpt.site`

```text
IDEA -> DESIGN -> GENERATE -> PLAYTEST -> REFINE -> BUILD -> PUBLISH
```

## AI 漫剧模式

正式影片编剧已提供 11 个项目适配 Skill，入口 `$filmgame-sw-workflow`，覆盖前提、结构、人物、场景、对白、格式、类型、润色与提案。使用 `npm run skills:check` 验证，版本保存与导出见 [编剧工作流](docs/SCREENWRITING_WORKFLOW.md)。

`http://localhost:3000/drama` 提供独立线性漫剧创作：自然语言剧本与修改提案、角色参考图和配音绑定、分镜编辑与排序、视频/分镜预演、可选配乐、整集预览及 MP4/字幕下载。无需多人运行时或 Unreal。

`http://localhost:3000/learn` 提供按制作步骤分类的 B 站原站教程播放器与创作提示词。使用方法、配置、开源选型与验收范围见 [docs/DRAMA_STUDIO.md](docs/DRAMA_STUDIO.md)。这些功能本轮在本地源码与服务中验证，远程 Sites 部署尚未更新。

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

## 换一台电脑

见 [docs/SETUP-NEW-MACHINE.md](docs/SETUP-NEW-MACHINE.md)：clone 之后装依赖、用 SOPS 恢复本地配置、下载模型权重、启动自检的完整步骤，以及哪些东西不在 git 里、各自怎么恢复。
