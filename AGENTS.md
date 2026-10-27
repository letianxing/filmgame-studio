# FilmGame Studio first-party rules

This directory is the commercial, first-party source of truth.

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
