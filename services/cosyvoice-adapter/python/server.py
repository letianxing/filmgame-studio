import argparse
import logging
import os
import sys
import tempfile
from collections.abc import Iterable
from pathlib import Path

import numpy as np
import uvicorn
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from wetext_cache import pin_wetext_to_local_cache, require_text_frontend, text_frontend_of


def authorize(authorization: str | None = Header(default=None)) -> None:
    expected = os.environ.get("COSYVOICE_ADAPTER_TOKEN")
    if expected and authorization != f"Bearer {expected}":
        raise HTTPException(status_code=401, detail="Unauthorized")


app = FastAPI(title="FilmGame CosyVoice Adapter", dependencies=[Depends(authorize)])
model = None


def pcm_stream(outputs: Iterable[dict], temporary_path: str | None = None):
    try:
        for output in outputs:
            yield (output["tts_speech"].numpy() * (2**15)).astype(np.int16).tobytes()
    finally:
        if temporary_path:
            Path(temporary_path).unlink(missing_ok=True)


def uploaded_audio(data: bytes) -> str:
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as output:
        output.write(data)
        return output.name


@app.get("/health")
async def health():
    # textFrontend is reported so a degraded normaliser is visible to callers instead of
    # only showing up as mispronounced numbers in the audio.
    return {
        "status": "HEALTHY" if model is not None else "STARTING",
        "sampleRate": getattr(model, "sample_rate", None),
        "textFrontend": text_frontend_of(model) or None,
    }


@app.post("/inference_sft")
async def inference_sft(
    tts_text: str = Form(),
    spk_id: str = Form(),
    speed: float = Form(default=1.0),
):
    outputs = model.inference_sft(tts_text, spk_id, stream=True, speed=speed)
    return StreamingResponse(pcm_stream(outputs), media_type="audio/L16")


@app.post("/inference_zero_shot")
async def inference_zero_shot(
    tts_text: str = Form(),
    prompt_text: str = Form(),
    prompt_wav: UploadFile = File(),
    speed: float = Form(default=1.0),
):
    prompt = uploaded_audio(await prompt_wav.read())
    outputs = model.inference_zero_shot(
        tts_text,
        prompt_text,
        prompt,
        stream=True,
        speed=speed,
    )
    return StreamingResponse(pcm_stream(outputs, prompt), media_type="audio/L16")


@app.post("/inference_cross_lingual")
async def inference_cross_lingual(
    tts_text: str = Form(),
    prompt_wav: UploadFile = File(),
    speed: float = Form(default=1.0),
):
    prompt = uploaded_audio(await prompt_wav.read())
    outputs = model.inference_cross_lingual(tts_text, prompt, stream=True, speed=speed)
    return StreamingResponse(pcm_stream(outputs, prompt), media_type="audio/L16")


@app.post("/inference_instruct")
async def inference_instruct(
    tts_text: str = Form(),
    spk_id: str = Form(),
    instruct_text: str = Form(),
    speed: float = Form(default=1.0),
):
    outputs = model.inference_instruct(
        tts_text,
        spk_id,
        instruct_text,
        stream=True,
        speed=speed,
    )
    return StreamingResponse(pcm_stream(outputs), media_type="audio/L16")


@app.post("/inference_instruct2")
async def inference_instruct2(
    tts_text: str = Form(),
    instruct_text: str = Form(),
    prompt_wav: UploadFile = File(),
    speed: float = Form(default=1.0),
):
    prompt = uploaded_audio(await prompt_wav.read())
    outputs = model.inference_instruct2(
        tts_text,
        instruct_text,
        prompt,
        stream=True,
        speed=speed,
    )
    return StreamingResponse(pcm_stream(outputs, prompt), media_type="audio/L16")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=50000)
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--cosyvoice-home", required=True)
    parser.add_argument(
        "--allow-degraded-text-frontend",
        action="store_true",
        help="Start even when no text normaliser loaded. Numbers and dates will be read "
        "digit by digit; only use this to get audio out of a machine with no cached FSTs.",
    )
    args = parser.parse_args()

    cosyvoice_home = Path(args.cosyvoice_home).resolve()
    sys.path.insert(0, str(cosyvoice_home))
    sys.path.insert(0, str(cosyvoice_home / "third_party" / "Matcha-TTS"))
    pin_wetext_to_local_cache()
    from cosyvoice.cli.cosyvoice import AutoModel

    global model
    model = AutoModel(model_dir=str(Path(args.model_dir).resolve()))
    require_text_frontend(
        model,
        allow_degraded=args.allow_degraded_text_frontend,
        opt_out_hint="or pass --allow-degraded-text-frontend to start anyway.",
    )

    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
