# Phase 0 Repository Audit

审计日期：2026-08-30（Asia/Shanghai）

审计范围：`G:\filmGame`、`G:\comfyui`、`G:\Epic Games`

## 1. 结论摘要

本机已具备开始第一方架构与 Contract 设计的基础，但尚不具备端到端启动条件。
所有现有仓库和安装目录均应继续视为第三方依赖、参考或基础设施；第一方商业代码的
Source of Truth 已确定为 `G:\filmGame\filmgame-studio`。

主要结论：

- 六个预期第三方项目均存在，但 LiveKit Agents 的实际目录名是 `agents`，不是
  `livekit-agents`。
- `filmgame-studio` 在审计开始前不存在；本报告创建于该第一方目录下。
- `filmgame` 明确限制为个人学习和非商业研究，未经书面授权不得商用。它只能作为
  clean-room 产品、工作流、UX 与 Domain Research 参考。
- Colyseus、Next.js、LiveKit Agents 框架代码和 CosyVoice 代码具备明确开源许可证，
  但模型、插件、可选组件及最终分发物仍需逐项建立 SBOM/许可证门禁。
- ComfyUI 是 Desktop 安装包而非 Git checkout；Desktop 版本为 `0.8.18.0`，其内置
  ComfyUI Core 为 `0.16.4`。内置 Core 提供 HTTP/WebSocket API，但当前没有模型权重，
  8188 端口也未监听。
- Unreal Engine 实际安装目录为 `G:\Epic Games\UE_5.7`，核实版本为 5.7.4，Editor、
  UnrealBuildTool 和 AutomationTool 均存在。
- Node.js 22 与 GPU 可用；`pnpm`、Docker、Conda 和 FFmpeg CLI 当前不在 PATH。
  CosyVoice 模型、Node 依赖和若干 Git submodule 尚未安装。

## 2. 组件清单

| Component | Local Path | Detected Version | License | Product Role | Integration Decision |
| --- | --- | --- | --- | --- | --- |
| LiveKit Agents | `G:\filmGame\agents` | package `1.7.1`; Git `livekit-agents@1.7.1-14-g1151b6eda` | Framework: Apache-2.0; bundled turn-detection models: separate LiveKit Model License | V2 Realtime Voice / STT / AI Agents | First-party `livekit-adapter`; not a V1 runtime dependency |
| Colyseus | `G:\filmGame\colyseus` | `@colyseus/core 0.18.10`; exact Git tag `@colyseus/core@0.18.10` | MIT | Authoritative Multiplayer Runtime | First-party multiplayer server depends on published server/API contracts |
| CosyVoice | `G:\filmGame\CosyVoice` | no project version field; Git `v2.0-152-g074ca6d` | Code: Apache-2.0; model licenses not present locally | TTS infrastructure | First-party `TTSProvider` through `cosyvoice-adapter` |
| FFmpeg | `G:\filmGame\FFmpeg` | `RELEASE=8.0.git`; Git `n9.1-dev-1028-gb32f8d1c23` | LGPL-2.1+ by default; GPL-2.0+ / GPL-3.0+ possible with optional components | Deterministic Media Processing | First-party `media-pipeline` owns all process invocation |
| filmgame | `G:\filmGame\filmgame` | package `0.5.0`; Git `8f0fddc` | Custom non-commercial terms in README; no standalone LICENSE file | Reference only | No code dependency and no source copying without written commercial authorization |
| Next.js | `G:\filmGame\next.js` | `next 16.4.0-canary.12`; exact Git tag `v16.4.0-canary.12` | MIT | Web application framework reference/source | First-party apps should consume a deliberately pinned published package, not modify this checkout |
| ComfyUI Desktop / Core | `G:\comfyui`; Core at `G:\comfyui\resources\ComfyUI` | Desktop `0.8.18.0`; Core `0.16.4` | Bundled Core: GPL-3.0; Electron/Chromium notices also bundled | Visual Production | Separate process through `ImageProvider` / `VideoProvider` adapter |
| Unreal Engine | `G:\Epic Games\UE_5.7` | 5.7.4, changelist `51494982`, branch `++UE5+Release-5.7` | Epic proprietary Unreal Engine EULA; no local EULA file detected | PC / Steam Runtime Client | First-party Unreal project; consume runtime packages and backend protocol only |

Version values above are observations from local files and Git state, not inferred release numbers.

## 3. Repository state and provenance

| Repository | Branch | Commit | Remote | Working Tree |
| --- | --- | --- | --- | --- |
| LiveKit Agents | `main` | `1151b6edac62787f79e79b4fd68eee2b09aa12fe` | `git@github.com:livekit/agents.git` | clean |
| Colyseus | `master` | `52c4cbe3f39d304121d7049f896b354770ad9c47` | `git@github.com:colyseus/colyseus.git` | clean; `packages/better-call` submodule not initialized |
| CosyVoice | `main` | `074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc` | `git@github.com:QwenAudio/CosyVoice.git` | clean; `third_party/Matcha-TTS` submodule not initialized |
| FFmpeg | `master` | `b32f8d1c2377079302d23f82d555d13deda68c57` | `git@github.com:FFmpeg/FFmpeg.git` | clean |
| filmgame | `master` | `8f0fddc91de32b09b6108d03070095e7abd36456` | `git@github.com:mmlong818/filmgame.git` | contains pre-existing untracked `fimGame.code-workspace` |
| Next.js | `canary` | `2fe6f962a1982594bdda96a7de16c594677266d2` | `git@github.com:vercel/next.js.git` | clean |

Git initially rejected these repositories because the filesystem does not record ownership. The audit used
per-command `safe.directory` overrides and did not modify global Git configuration.

## 4. Component findings

### 4.1 LiveKit Agents

Evidence:

- `livekit-agents/pyproject.toml` declares package `livekit-agents`, Apache-2.0, and Python
  `>=3.10,<3.15`.
- `livekit/agents/version.py` declares `1.7.1`.
- The framework exposes provider-neutral LLM, STT, TTS and realtime interfaces, plus
  `Agent`, `AgentSession`, `AgentServer`, job dispatch, RPC/Data APIs, telemetry and provider plugins.
- Documented commands are `python myagent.py console`, `dev`, `start` and `connect`.
- Runtime configuration includes `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` and optional
  `LIVEKIT_AGENT_NAME`.

Decision:

- Keep LiveKit out of the V1 critical path.
- Define a first-party speech-to-intent / realtime-agent contract now; implement the adapter in V2.
- Never let a LiveKit agent mutate authoritative story state. It may emit validated intents only.
- The separate `MODEL_LICENSE` restricts bundled LiveKit models to use with the LiveKit Agents framework;
  model use must be tracked independently from framework code.

### 4.2 Colyseus

Evidence:

- Monorepo root requires Node `>=22.0.0`, pnpm `>=8.15.0`, and declares `pnpm@10.9.0`.
- `@colyseus/core` exports `Server`, `Room`, matchmaking and authoritative server primitives.
- Local source confirms message handlers, reconnection, snapshots/state synchronization, drivers,
  presence and WebSocket transport support.
- Published client packages include TypeScript, React and other engines/platforms. No local Unreal plugin,
  `.uplugin`, or C++ SDK was found in this checkout.
- Upstream quickstart is `npm create colyseus-app@latest`, followed by `npm start`.

Decision:

- Use Colyseus as the authoritative server foundation, but keep all story rules, state mutation,
  role authorization, snapshots and event logs in first-party modules.
- Companion Web should use `@colyseus/sdk` behind a first-party client facade.
- Unreal integration requires a separately designed and versioned WebSocket/protocol client or an evaluated
  native SDK; it must not assume a local Unreal SDK exists here.
- Do not depend on the upstream monorepo source tree from production apps; pin published packages.

### 4.3 CosyVoice

Evidence:

- README recommends a Python 3.10 Conda environment and exposes direct Python inference through `example.py`.
- Deployment examples provide Dockerized gRPC and FastAPI servers on port 50000.
- FastAPI sample endpoints include `/inference_sft`, `/inference_zero_shot`,
  `/inference_cross_lingual`, `/inference_instruct`, and `/inference_instruct2`.
- The FastAPI sample streams raw signed 16-bit PCM bytes, enables wildcard CORS, and contains no first-party
  authentication, job lifecycle, idempotency, health, metadata or persistence contract.
- gRPC exposes a streaming `CosyVoice.Inference` RPC.
- `pretrained_models` is absent and the required `third_party/Matcha-TTS` submodule is uninitialized.

Decision:

- Wrap the service in `cosyvoice-adapter`; Story Studio and the orchestrator depend only on `TTSProvider`.
- The adapter must add authentication, request validation, job IDs, timeouts, cancellation, retries,
  deterministic output metadata, WAV/container encoding, storage handoff and health/readiness endpoints.
- Track `voiceId`, reference audio rights, model identifier/version, language, style, emotion and speed.
- Verify each downloaded model's model card/license before commercial use; the repository's Apache-2.0 code
  license does not by itself establish model-weight or voice-reference rights.

### 4.4 FFmpeg

Evidence:

- The local path is an FFmpeg source checkout, not an installed Windows binary; no `ffmpeg.exe` exists and
  no `ffmpeg` command is available in PATH.
- The source exposes the `ffmpeg`, `ffprobe` and `ffplay` tools plus libavcodec, libavformat, libavfilter,
  libavutil, libswresample and libswscale.
- `LICENSE.md` states LGPL-2.1+ for the default configuration. Enabling GPL components changes the combined
  distribution license; some optional parts are GPL-3.0+.

Decision:

- Provision a known Windows FFmpeg build or a reproducible internal build; record binary hash,
  `ffmpeg -version`, `-buildconf`, codec/filter inventory and license notices.
- A release must fail if its FFmpeg provenance or build configuration is unknown.
- Centralize mux, concat, audio mix, normalization, subtitles, transcode, thumbnails, proxies and final
  rendering in `media-pipeline`; never scatter shell commands through business code.

### 4.5 filmgame reference

Evidence:

- Package version is `0.5.0`; actual dependencies include Next.js 16.2.1, React 19.2.4,
  LangGraph, Drizzle, PostgreSQL, XYFlow and Zustand.
- The product demonstrates a five-stage single-creator workflow, visual narrative graph, scene workshop,
  AI providers, validation, previews and Postgres persistence.
- README grants only personal learning and non-commercial research and requires written authorization for
  commercial use. There is no standalone LICENSE file.

Decision:

- Reference only: product research, UX observations, workflow vocabulary and domain gap analysis.
- No runtime/package dependency, no cross-repository source copy, and no implementation-level porting.
- Any future reuse requires explicit written commercial authorization plus a recorded legal review.
- Preserve the pre-existing untracked `fimGame.code-workspace`; this audit did not alter it.

### 4.6 Next.js

Evidence:

- Local upstream checkout is exact tag `v16.4.0-canary.12` and MIT licensed.
- The published `next` package requires Node `>=20.9.0`; the monorepo declares pnpm 10.33.0.
- Core entrypoints are the documented dev, build and start CLI paths under `packages/next`.

Decision:

- Use Next.js for Creator Console, Story Studio, dashboards and companion web.
- Do not build the commercial product inside or by modifying this upstream checkout.
- Select and pin a production release deliberately during workspace bootstrap; do not inherit the local
  canary merely because it is present.

### 4.7 ComfyUI

Evidence:

- `G:\comfyui` is a packaged Electron Desktop application (`ComfyUI.exe`), not a Git repository.
- Executable metadata reports Desktop `0.8.18.0`; bundled `comfyui_version.py` and `pyproject.toml`
  report Core `0.16.4`, Python `>=3.10`.
- Bundled Core is GPL-3.0 and contains HTTP/WebSocket routes including `/ws`, `/prompt`, `/history`,
  `/queue`, `/view`, `/object_info`, `/upload/image`, `/interrupt` and `/system_stats`.
- CLI defaults are `127.0.0.1:8188` and support injected base, input, output, temp and model paths.
- The bundled model tree contains configuration/placeholders only: no checkpoint, safetensors, ONNX,
  GGUF or other model weight larger than 1 MiB was detected.
- Output is empty, only the sample custom node is present, and port 8188 is not listening.

Decision:

- Integrate as a separately managed process over HTTP/WebSocket through `comfyui-adapter`.
- Do not link or copy GPL Core into proprietary first-party services; record legal review for distribution
  topology and any custom nodes shipped with the product.
- Maintain first-party, versioned workflow templates outside the upstream installation, then submit API-format
  workflows and collect outputs through the adapter.
- Startup, health, queue ownership, cancellation, timeouts, output discovery, provider metadata and failure
  normalization belong to the adapter/orchestrator.
- All machine paths and the base URL must be configuration-injected. Desktop and Core version numbers must be
  tracked separately.

### 4.8 Unreal Engine 5.7.4

Verified paths:

| Capability | Path / Result |
| --- | --- |
| Engine root | `G:\Epic Games\UE_5.7` |
| Editor | `G:\Epic Games\UE_5.7\Engine\Binaries\Win64\UnrealEditor.exe` |
| UnrealBuildTool | `G:\Epic Games\UE_5.7\Engine\Binaries\DotNET\UnrealBuildTool\UnrealBuildTool.exe` |
| AutomationTool launcher | `G:\Epic Games\UE_5.7\Engine\Build\BatchFiles\RunUAT.bat` |
| Build launcher | `G:\Epic Games\UE_5.7\Engine\Build\BatchFiles\Build.bat` |
| Plugins | `G:\Epic Games\UE_5.7\Engine\Plugins` |
| Installed build marker | `G:\Epic Games\UE_5.7\Engine\Build\InstalledBuild.txt` |
| Build metadata | 5.7.4, CL 51494982, compatible CL 47537391 |

`GenerateProjectFiles.bat` is not included in this installed build. Project generation remains available through
UnrealBuildTool's `-ProjectFiles` / `GenerateProjectFiles` mode, which is present in local source and executable.

Decision:

- Create a separate first-party project at `filmgame-studio\unreal\FilmGameClient` in a later phase.
- Unreal remains a runtime client: login/lobby, media playback, presentation, backend protocol and packaged
  runtime content. Story authoring and production orchestration do not move into Unreal.
- Build automation must call UBT/UAT via configuration, never hardcode this machine path in business code.
- Runtime content should be consumed through a versioned Runtime Package + Asset Manifest.
- No local EULA file was found in the installed engine. Commercial release planning must follow the current
  [official Unreal Engine EULA](https://www.unrealengine.com/eula/unreal), including the applicable distribution,
  notice, seat and royalty terms; legal/finance review remains a release gate.

## 5. Local toolchain readiness

| Capability | Observed State | Impact |
| --- | --- | --- |
| OS | Windows | First-party scripts must support PowerShell/Windows paths |
| Node.js | `v22.19.0` | Meets Colyseus and Next.js requirements; does not meet filmgame reference's documented Node 24+ requirement |
| npm | `11.6.4` | Available |
| Corepack | `0.34.0` | Available; can provision a pinned pnpm after the bootstrap decision |
| pnpm | not in PATH | Colyseus/Next.js monorepo builds are not ready |
| Python | `3.13.7` | Meets LiveKit Agents range; CosyVoice documents Python 3.10 and needs an isolated environment |
| uv | `0.11.28` | Available for LiveKit/first-party Python tooling |
| Conda | not in PATH | CosyVoice's documented local setup is not ready |
| Docker | not in PATH | CosyVoice container deployment and reference Postgres workflow cannot run locally yet |
| FFmpeg CLI | not in PATH | Media pipeline cannot run until a vetted binary is provisioned |
| GPU | NVIDIA GeForce RTX 4070 Ti SUPER, 16,376 MiB; driver 610.88 | Suitable for initial local inference experiments; each image/video/TTS workflow still needs VRAM benchmarking |
| Expected ports | 3000, 2567, 50000 and 8188 all not listening | No audited service was running during inspection |
| Node dependencies | no `node_modules` in Colyseus, filmgame or Next.js | Source checkouts are not bootstrapped |
| CosyVoice assets | no `pretrained_models`; Matcha-TTS submodule empty | TTS is not runnable yet |
| ComfyUI assets | no model weights detected | Visual generation is not runnable yet |

This was a non-invasive audit. It did not install packages, download models, initialize submodules, launch apps,
change Git configuration, or run builds.

## 6. Proposed integration boundaries

| External System | First-party Boundary | Contract |
| --- | --- | --- |
| LiveKit Agents | `services/livekit-adapter` | Speech/realtime intents and agent events; no authoritative mutation |
| Colyseus | `apps/multiplayer-server` + shared runtime protocol | WebSocket, typed intent messages, server-owned state and event log |
| CosyVoice | `services/cosyvoice-adapter` implementing `TTSProvider` | Authenticated job API + stored audio result and provider metadata |
| FFmpeg | `services/media-pipeline` | Typed media jobs and deterministic manifests |
| ComfyUI | `services/comfyui-adapter` implementing `ImageProvider`/`VideoProvider` | HTTP/WebSocket workflow jobs and asset results |
| Next.js | first-party apps | Published framework dependency pinned in the workspace |
| Unreal Engine | `unreal/FilmGameClient` | Versioned WebSocket/API protocol + Runtime Package + Asset Manifest |
| filmgame | none | Clean-room research only |

The first formal cross-module contracts should be:

- `story.schema.json`
- `production.schema.json`
- `runtime.schema.json`
- `asset-manifest.schema.json`

## 7. Configuration inventory

The following names are proposed for a future `.env.example`; no secret values should be committed:

```text
COMFYUI_HOME=
COMFYUI_BASE_URL=http://127.0.0.1:8188
COMFYUI_WORKFLOW_DIR=
COMFYUI_OUTPUT_DIR=

COSYVOICE_HOME=
COSYVOICE_BASE_URL=http://127.0.0.1:50000

FFMPEG_PATH=
FFPROBE_PATH=

UNREAL_ENGINE_ROOT=
UNREAL_EDITOR_PATH=
UNREAL_BUILD_TOOL_PATH=
UNREAL_AUTOMATION_TOOL_PATH=

COLYSEUS_SERVER_URL=ws://127.0.0.1:2567

LIVEKIT_URL=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
```

These are architecture inputs, not yet a committed configuration contract. Secret values belong only in
ignored local or managed-secret storage.

## 8. Risks and gates

### Blocking before local vertical slice

1. Select and pin the first-party workspace toolchain and package manager.
2. Provision pnpm, a database path, and a vetted FFmpeg binary.
3. Establish isolated CosyVoice runtime requirements; initialize required submodule and download only
   license-approved model weights.
4. Install/configure at least one license-approved ComfyUI workflow and model set.
5. Define Story, Production, Runtime and Asset Manifest contracts before wiring providers.
6. Design the Unreal-to-Colyseus protocol because no local Unreal client SDK is present.

### Commercial/legal gates

1. Keep `filmgame` out of all dependencies and copied code unless written commercial authorization exists.
2. Record CosyVoice/ComfyUI model and custom-node licenses separately from repository licenses.
3. Record the exact FFmpeg build configuration and comply with its effective LGPL/GPL obligations.
4. Review ComfyUI GPL process/distribution topology before shipping adapters or custom nodes.
5. Review Unreal EULA, release notice and royalty/seat obligations before a commercial release candidate.
6. Generate an SBOM and third-party notices for every release artifact.

## 9. Recommended Phase 1 entry

Proceed with a minimal first-party monorepo bootstrap under `G:\filmGame\filmgame-studio`, then implement in
this order:

1. Architecture decision records and ownership boundaries.
2. The four JSON Schema contracts and generated shared types.
3. Deterministic resolution-engine kernel with no LLM-owned state.
4. A minimal Colyseus room using typed role intents and event logging.
5. Creator Console shell and one end-to-end natural-language change preview flow.
6. Stub provider SDK plus health-check adapters for ComfyUI, CosyVoice and FFmpeg.
7. One pre-generated scene vertical slice through Asset Manifest to Companion Web and Unreal runtime loading.

Phase 0 is complete when this report is accepted as the baseline; environment installation and service startup
belong to the subsequent bootstrap/integration work.
