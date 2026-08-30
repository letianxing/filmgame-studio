# Local AI Resource Policy

Local generation is an optional provider tier. It must never destabilize the Creator Console, multiplayer runtime, or the creator's workstation.

## Defaults on this workstation

- ComfyUI uses the `SAFE` profile: low VRAM, no pinned memory, no async offload, no DynamicVRAM, and 1 GiB reserved VRAM.
- The ComfyUI adapter checks free physical RAM during prompts and interrupts below `COMFYUI_MINIMUM_FREE_RAM_BYTES`.
- Generative GPU jobs (`STORYBOARD`, `IMAGE`, `VIDEO`, `TTS`, `MUSIC`, `SFX`) are serialized by the Production Orchestrator.
- Local Wan video generation is disabled by default with `COMFYUI_LOCAL_VIDEO_ENABLED=false`.
- The platform must select another configured `VideoProvider` when local video is disabled. Story and runtime domain models do not depend on that provider choice.

## Verified observations (2026-08-30)

- FLUX.1 Schnell FP8 produced a real 768×432 storyboard image.
- Wan2.2 TI2V 5B, its VAE, and UMT5 encoder were installed and the API workflow was accepted by ComfyUI.
- DynamicVRAM mode approached the 2 GiB physical-RAM floor and was interrupted safely.
- Estimate-based loading avoided that physical-RAM floor, but Windows recorded virtual-memory exhaustion while other workstation applications were active. Local Wan is therefore not an eligible automatic production provider on this machine.

Do not lower safety floors, retry a resource-exhausted local job automatically, close unrelated user applications, or change the Windows pagefile without explicit user authorization.

## Capacity admission

Before enabling local video on another machine, require a bounded smoke test under representative workstation load. Record model hashes and licenses, physical and committed-memory headroom, peak VRAM, FFprobe validation, generation time, and the exact ComfyUI memory profile.

Passing only on an idle machine is not sufficient for production admission.
