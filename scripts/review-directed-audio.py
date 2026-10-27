"""Local ASR timing evidence for editorial review; never rewrites the approved dialogue."""
import argparse
import json
from pathlib import Path

import torch
import whisper

parser = argparse.ArgumentParser()
parser.add_argument("--input", required=True)
parser.add_argument("--output", required=True)
parser.add_argument("--model", default="small")
args = parser.parse_args()
torch.set_num_threads(4)
model = whisper.load_model(args.model, device="cpu")
result = model.transcribe(args.input, language="zh", fp16=False, word_timestamps=True)
Path(args.output).parent.mkdir(parents=True, exist_ok=True)
Path(args.output).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({"text": result["text"], "segments": [
    {"start": s["start"], "end": s["end"], "text": s["text"]} for s in result["segments"]
]}, ensure_ascii=False))
