## 2026-11-08 最新用户要求：剧情背景和提示词也须人审

每节点生成图片前先审剧情/分镜说明与完整图片提示词；图生成后连同背景故事和实际提示词审图；概念图与完整视频提示词均明确通过后才生视频，成片再审。审核必须注明前因后果、人物动机、场景站位/光照、首尾状态、分支影响、参考版本和预计费用。实质改动须重审受影响项，不自动沿用旧批准。详细执行规则见 G:/filmGame/filmgame-studio/docs/NODE-CONTINUITY-WORKFLOW.md 顶部。此为 agent 执行门，勿声称新增服务端硬门禁。

# FilmGame Studio first-party rules

## 2026-11-05 User direction: controlled production, separate runtime

- Latest delivery instruction: after completing and testing this FilmGame upgrade, inspect changes and secrets, then git add, commit and push; report the commit and push result. Do not resume sandbox-game node work without the user's next instruction. Keep GPU available for the user's game; no UE, model generation or GPU encoding during this upgrade.

- FilmGame Studio owns concept/storyboard/media production, basic review, human review, cost/quota/time/attempt controls, adopted asset versions and visible production progress. The sandbox-game agent primarily owns UE5 runtime integration and playable acceptance.
- Follow the production control contract in `docs/ARCHITECTURE.md` (2026-11-05 section). This is a required target, not a claim that all controls are implemented.
- Do not let a single asset enter unbounded autonomous repair. Escalate at configured spend/time/attempt limits with concrete candidates, evidence and tradeoffs; continue independent runtime tasks where possible. User cancellation of the historical two-round rule remains valid; do not silently reinstate it.
- Concept and video adoption require explicit human review of the exact revision. Basic automated review is advisory and cannot manufacture aesthetic approval. Waiting, notification delivery and approval are distinct states.
- Supply reviewed, versioned manifests to UE; runtime defect reports return to Studio rather than spawning an unmanaged generation loop in the game repository. Existing accepted media should be reused.

This directory is the commercial, first-party source of truth.

## 2026-11-06 Node continuity before paid generation

- Follow `docs/NODE-CONTINUITY-WORKFLOW.md` for every node, including branches and cross-node transitions.
- Before paying for video, verify actual character AND scene reference bindings against adopted versions, incoming/outgoing states, geography, lighting, props and dialogue. Written scene descriptions alone are not a scene reference.
- Reuse established environments and identities. For new environments review a low-cost spatial keyframe first. Produce one representative shot before batching dependent shots.
- Diagnose the user's rejected dimension, preserve approved inputs, and record what changed before retrying. Technical playback is not continuity approval. Do not claim the full semantic gate is automated.

- Treat sibling repositories and local installations as upstream dependencies or research references.
- Never copy implementation code from `../filmgame`; its README prohibits commercial use without written authorization.
- Natural language is the primary authoring interface, but structured, validated and versioned domain data is authoritative.
- LLMs may propose changes and interpret player intent. They must never mutate authoritative multiplayer state.
- All runtime mutations pass schema validation and deterministic server-side resolution.
- Story Studio depends on domain/application contracts, never directly on a concrete AI or media provider.
- Machine paths and credentials are configuration. Do not hardcode them in business code or commit secrets.
- Prefer adapter, HTTP, WebSocket, CLI and manifest boundaries over upstream source modification.
- Add focused tests for schema, dependency, versioning and resolution behavior before wiring external providers.
- Never materialize a recursive file listing for Unreal Engine, model stores, ComfyUI, caches, or other large trees. Use exact-path checks, bounded depth, streaming tools, and capped output; do not compute directory size by collecting every file object in memory.

## Film screenwriting

- For formal screenplay development, use `.agents/skills/filmgame-sw-workflow/SKILL.md` and select only the needed modules. For narrow dialogue or scene edits, use the matching project skill directly.
- Follow `docs/SCREENWRITING_WORKFLOW.md` for validated, immutable screenplay versions and readable exports. Respect explicitly locked story decisions and the requested revision scope.
- Screenwriting skills do not authorize media spending or publication. Preserve existing user authorization and route approved scripts to the existing director workflow.

## Local media resource safety

- This workstation restarted during media production on 2026-10-13. Treat local memory headroom as a production constraint.
- Run one heavy local media/ASR job at a time. Do not start ComfyUI, local speech models, or the full service stack just to review an existing video.
- For director-cut rendering and assembly, use `scripts/media_resource_guard.py`: one guarded job per user, FFmpeg RSS limit 1024 MiB, minimum free disk 2 GiB, timeout 30 minutes; monitor every 0.5 seconds. This is a watchdog, not an OS hard memory limit or a guard for every application service.
- Keep FFmpeg decode/encode threads at 2 and filter threads at 1. Stream a single subtitle overlay; never create one looping video input per subtitle for long-form exports.
- Validate changes with a short bounded sample first. Preserve accepted media; write final exports to a partial file and replace only after successful completion. Do not automatically repeat failed expensive jobs.

## Video engine selection

- Follow the user's explicit engine choice for each production run. WAN means the explicitly configured local runtime (MLX on this Mac, or ComfyUI); never fall back to Seedance or another paid endpoint after a local error.
- Paid director runs require `--backend SEEDANCE`. Local shot runs use `scripts/produce-local-wan.ts`; the console records `videoBackend` with each render and separates cache identity by engine.
- Wan TI2V-5B is video-only. Do not label separate TTS mixing as native dialogue or lip synchronization. Native audio-video and lip-sync alternatives require their own observed sample validation.
- On this Mac use the guarded `scripts/wan-mlx-worker.py` through the local adapter. The ComfyUI path uses `scripts/start-wan-safe.py` and remains a separate evaluation path after observed corrupt-frame failures; never start the unguarded full stack. Keep ASR, image/video inference and local encoders serial. First-frame approval and physical continuity remain required regardless of provider.
