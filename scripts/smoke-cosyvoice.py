import json
import os
import sys
from pathlib import Path

import torch
import torchaudio

cosyvoice_home = Path(os.environ["COSYVOICE_HOME"])
model_dir = Path(os.environ["COSYVOICE_MODEL_DIR"])
workspace = Path(__file__).resolve().parents[1]
output_path = workspace / "artifacts" / "cosyvoice-smoke" / "zero-shot.wav"
output_path.parent.mkdir(parents=True, exist_ok=True)

sys.path.insert(0, str(cosyvoice_home))
sys.path.insert(0, str(cosyvoice_home / "third_party" / "Matcha-TTS"))
sys.path.insert(0, str(workspace / "services" / "cosyvoice-adapter" / "python"))

from wetext_cache import pin_wetext_to_local_cache, require_text_frontend  # noqa: E402

pin_wetext_to_local_cache()

from cosyvoice.cli.cosyvoice import AutoModel  # noqa: E402

model = AutoModel(model_dir=str(model_dir))
# A smoke test that passes while text normalisation is silently off is worse than useless,
# so fail here rather than reporting HEALTHY.
text_frontend = require_text_frontend(
    model,
    allow_degraded=os.environ.get("COSYVOICE_ALLOW_DEGRADED_TEXT_FRONTEND") == "1",
    opt_out_hint="or set COSYVOICE_ALLOW_DEGRADED_TEXT_FRONTEND=1 to smoke-test anyway.",
)
chunks = list(
    model.inference_zero_shot(
        "暴风雪封锁了山顶酒店。",
        "希望你以后能够做的比我还好呦。",
        str(cosyvoice_home / "asset" / "zero_shot_prompt.wav"),
        stream=False,
    )
)
if not chunks:
    raise RuntimeError("CosyVoice produced no audio")
audio = torch.cat([chunk["tts_speech"] for chunk in chunks], dim=1)
torchaudio.save(str(output_path), audio, model.sample_rate)
print(
    json.dumps(
        {
            "status": "HEALTHY",
            "model": str(model_dir),
            "textFrontend": text_frontend or None,
            "sampleRate": model.sample_rate,
            "samples": audio.shape[1],
            "output": str(output_path),
            "cuda": torch.cuda.is_available(),
        },
        ensure_ascii=False,
    )
)

