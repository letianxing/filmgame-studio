#!/usr/bin/env bash
# macOS/Linux counterpart of smoke-production-providers.ps1.
set -euo pipefail

workspace="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

python3 - "$workspace" <<'PY'
import json, sys, urllib.error, urllib.request
from pathlib import Path

workspace = Path(sys.argv[1])


def read_environment_file(path: Path) -> dict:
    if not path.is_file():
        sys.exit(f"Missing configuration file: {path}")
    values = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        trimmed = line.strip()
        if not trimmed or trimmed.startswith("#") or "=" not in trimmed:
            continue
        key, value = trimmed.split("=", 1)
        values[key] = value
    return values


def require_value(values: dict, name: str, path: Path) -> str:
    value = values.get(name, "")
    if not value or "<" in value or "example.com" in value:
        sys.exit(f"{name} is missing or still a placeholder in {path}")
    return value


def test_gateway(name: str, base_url: str, token: str) -> dict:
    request = urllib.request.Request(
        base_url.rstrip("/") + "/health",
        headers={"Authorization": f"Bearer {token}"},
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            payload = json.load(response)
    except urllib.error.URLError as error:
        sys.exit(f"{name} is unreachable at {base_url}: {error}")
    if payload.get("status") != "HEALTHY":
        sys.exit(f"{name} health is not HEALTHY: {payload}")
    return {"provider": name, "baseUrl": base_url, "status": "HEALTHY"}


root_path = workspace / ".env.local"
video_path = workspace / "services/video-gateway/.env.local"
audio_path = workspace / "services/audio-gateway/.env.local"
storage_path = workspace / "services/storage-gateway/.env.local"

root = read_environment_file(root_path)
video = read_environment_file(video_path)
audio = read_environment_file(audio_path)
storage = read_environment_file(storage_path)

video_base = require_value(root, "REMOTE_VIDEO_BASE_URL", root_path)
video_token = require_value(root, "REMOTE_VIDEO_API_TOKEN", root_path)
audio_base = require_value(root, "REMOTE_AUDIO_BASE_URL", root_path)
audio_token = require_value(root, "REMOTE_AUDIO_API_TOKEN", root_path)
storage_base = require_value(root, "REMOTE_STORAGE_BASE_URL", root_path)
storage_token = require_value(root, "REMOTE_STORAGE_API_TOKEN", root_path)

if video_token != require_value(video, "FILMGAME_VIDEO_GATEWAY_TOKEN", video_path):
    sys.exit("Video internal tokens do not match.")
if audio_token != require_value(audio, "FILMGAME_AUDIO_GATEWAY_TOKEN", audio_path):
    sys.exit("Audio internal tokens do not match.")
if storage_token != require_value(storage, "FILMGAME_STORAGE_GATEWAY_TOKEN", storage_path):
    sys.exit("Storage internal tokens do not match.")

require_value(video, "ARK_API_KEY", video_path)
require_value(video, "ARK_VIDEO_MODEL", video_path)
require_value(audio, "ELEVENLABS_API_KEY", audio_path)
require_value(storage, "STORAGE_S3_ACCESS_KEY_ID", storage_path)
require_value(storage, "STORAGE_S3_SECRET_ACCESS_KEY", storage_path)

rows = [
    test_gateway("Seedance Video Gateway", video_base, video_token),
    test_gateway("ElevenLabs Audio Gateway", audio_base, audio_token),
    test_gateway("R2/S3 Storage Gateway", storage_base, storage_token),
]
width = max(len(row["provider"]) for row in rows)
for row in rows:
    print(f"{row['provider']:<{width}}  {row['baseUrl']:<24}  {row['status']}")
PY
