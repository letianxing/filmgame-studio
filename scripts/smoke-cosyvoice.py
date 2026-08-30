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

from cosyvoice.cli.cosyvoice import AutoModel  # noqa: E402

model = AutoModel(model_dir=str(model_dir))
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
            "sampleRate": model.sample_rate,
            "samples": audio.shape[1],
            "output": str(output_path),
            "cuda": torch.cuda.is_available(),
        },
        ensure_ascii=False,
    )
)

