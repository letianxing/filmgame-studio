# Local audiovisual review pilot

This adapter collects model evidence, not asset approval. Existing Studio approval,
provenance and runtime gates remain authoritative. Do not record model decisions as
LOCAL_CREATOR, or describe sampled visual input as exhaustive original-frame review.

## Upstream and deployment

- Model: https://github.com/OpenBMB/MiniCPM-V (MiniCPM-o 4.5).
- Official deployment link leads to https://github.com/tc-mb/llama.cpp-omni.
- Windows pilot uses the Comni v1.0.22 release's bundled CUDA `llama-server.exe`.
- Only Q4_K_M LLM, F16 audio encoder and F16 vision encoder are needed; TTS is off.
- Executables/weights are external local configuration, never committed. Keep model
  and temporary directories off a nearly full system drive. Verify weight SHA256
  against the publisher's Hugging Face LFS metadata before inference.
- The bundled legacy HTTP server and current upstream standalone omni server differ;
  this pilot targets the bundled legacy routes. Do not silently upgrade binaries.

## Execution

`scripts/review-omni-local.py --prepare-only --input VIDEO --work NEW_DIRECTORY`
extracts bounded 16kHz audio and sampled images. Source hash and coverage go into
`input.json`. Existing work directories are not overwritten. Full audio including
the fractional final tail is retained; visual sampling can miss brief defects.

Run inference under `scripts/run-omni-guarded.py --server EXE --model GGUF
--work LOG_DIRECTORY -- python scripts/review-omni-local.py --input VIDEO
--work NEW_DIRECTORY --model-dir MODEL_DIRECTORY --prompt-file PROMPT`.
Paths in this example are placeholders. Both programs use localhost port 19080 by
default. A custom port requires matching `--endpoint` on the worker.

The launcher starts one server, checks initial RAM/VRAM, monitors available system
RAM and elapsed time, and terminates its own processes after completion or failure.
It never closes other applications. No voice synthesis or paid generation is used.
`resources.json` contains actual resource measurements. The worker emits raw model
events and source metadata in `review.json`, always with `approval: NOT_APPROVED`.

## Calibration and acceptance

1. Run a short real clip to establish that both vision AND audio are actually consumed.
2. Compare known accepted and known defective examples without putting their verdicts
   into the prompt. Include wrong action causality, lighting seams and missing dialogue.
3. Check audio-only and visual-only observations separately; transcription accuracy
   does not prove emotional or lip-sync judgement. Silence is not missing audio.
4. Record missed defects and false alarms. Recheck brief motion at higher sampling
   density over shorter windows; use dedicated sync metrics where available.
5. Until calibration succeeds, all quality verdicts are advisory. Never let a generic
   positive model answer release pending assets or trigger dependent paid generation.

This is not yet an automatic Studio review service. Adding a provider does not prove
that it meets the game's cinematic quality gate.

## Observed pilot, 2026-11-11

The Windows binary reports build `74 (4d28373)`; binary SHA256 is
`679bdc425d24b51658d744eb49b56a1fca32e63bc5bef7fc12fffcc08083d917`.
All three weights were checked against publisher LFS SHA256. The actual joint-input
smoke test succeeded on RTX 4070 Ti SUPER (16GB): first cold six-second clip took
67.23s including server lifecycle, peak process RSS 5.14GiB, minimum free system RAM
7.11GiB. Warm follow-up took 8.28s; server terminated and released memory afterward.
These are measured samples, not throughput or maximum-input guarantees.

Quality calibration FAILED for independent cinematic approval: model invented
timestamps beyond the six-second input and, in one broad-prompt run, invented
historical character identities. Restricting role names and supplying the term
`里正` improved transcription and identity wording, but did not fix timestamps.
The adapter marks out-of-window timestamps or acknowledgement-only answers `INVALID_OR_INCOMPLETE`; even clean responses
remain `UNCALIBRATED_ADVISORY`. Input audio is consumed (not merely ASR fed to a
text model), but this does not establish reliable emotion, contact physics, or sync
judgement. No assets were approved by these runs.

The current worker places the actual question inside the supported user-template
override: legacy `prefill.text` was not reliably consumed, and system-only task text
sometimes produced acknowledgements instead of observations. A later window yielded
actions and environmental observations after this correction. First-window dialogue
matched the independent game script (`家里只有我们两口。要查，叫里正来。`), but this is
one positive transcription sample, not comprehensive calibration. Missing fire detail,
incomplete answers and invented timestamps remain limitations. Coverage of the
24.15-second contact composite was attempted in overlapping windows; no full-quality
approval is implied.
