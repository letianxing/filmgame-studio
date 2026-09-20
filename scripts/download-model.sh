#!/usr/bin/env bash
# macOS/Linux counterpart of download-model.ps1.
#
# Unlike the PowerShell version this re-invokes curl per attempt instead of relying on
# --retry. curl evaluates --continue-at once at startup, so a mid-transfer retry restarts
# from byte 0 and truncates the partial file — fatal for a 16 GB checkpoint over a flaky link.
set -euo pipefail

model_id=""
verify_hash=0
while [ $# -gt 0 ]; do
    case "$1" in
        -Id|--id) model_id="$2"; shift 2 ;;
        -VerifyHash|--verify-hash) verify_hash=1; shift ;;
        *) model_id="$1"; shift ;;
    esac
done
[ -n "$model_id" ] || { echo 'Usage: download-model.sh --id <model-id> [--verify-hash]' >&2; exit 1; }

workspace="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
registry_path="$workspace/config/model-registry.json"
environment_path="$workspace/.env.local"

if [ -f "$environment_path" ]; then
    while IFS= read -r line || [ -n "$line" ]; do
        case "$line" in ''|\#*) continue ;; esac
        [[ "$line" == *=* ]] || continue
        export "${line%%=*}=${line#*=}"
    done < "$environment_path"
fi

base_directory="${COMFYUI_BASE_DIRECTORY:-}"
[ -n "$base_directory" ] || { echo 'COMFYUI_BASE_DIRECTORY must be set in .env.local.' >&2; exit 1; }

read -r download_url relative_path expected_bytes expected_sha256 < <(python3 -c '
import json, sys
registry = json.load(open(sys.argv[1]))
model = next((m for m in registry["models"] if m["id"] == sys.argv[2]), None)
if model is None:
    sys.exit("Unknown model id: " + sys.argv[2])
if not (model.get("downloadUrl") and model.get("relativeModelPath") and model.get("expectedBytes")):
    sys.exit("Model %s has no downloadable binary metadata." % sys.argv[2])
print(model["downloadUrl"], model["relativeModelPath"], model["expectedBytes"], model.get("sha256") or "-")
' "$registry_path" "$model_id")

model_root="$base_directory/models"
destination="$model_root/$relative_path"
case "$(python3 -c 'import os,sys; print(os.path.realpath(os.path.dirname(sys.argv[1])))' "$destination")" in
    "$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$model_root")"*) ;;
    *) echo 'Resolved model destination escaped the configured model root.' >&2; exit 1 ;;
esac
mkdir -p "$(dirname "$destination")"

existing_bytes=0
[ -f "$destination" ] && existing_bytes="$(stat -f%z "$destination" 2>/dev/null || stat -c%s "$destination")"
if [ "$existing_bytes" -gt "$expected_bytes" ]; then
    echo "Existing file is larger than expected: $existing_bytes > $expected_bytes" >&2
    exit 1
fi

attempt=0
while [ "$existing_bytes" -lt "$expected_bytes" ]; do
    attempt=$((attempt + 1))
    [ "$attempt" -le 20 ] || { echo "Gave up after $((attempt - 1)) attempts at $existing_bytes / $expected_bytes bytes" >&2; exit 1; }
    echo "Resuming $model_id at $existing_bytes / $expected_bytes bytes (attempt $attempt)"
    curl --fail --location --continue-at - --output "$destination" "$download_url" || true
    previous="$existing_bytes"
    existing_bytes="$(stat -f%z "$destination" 2>/dev/null || stat -c%s "$destination")"
    if [ "$existing_bytes" -le "$previous" ] && [ "$existing_bytes" -lt "$expected_bytes" ]; then
        sleep 10
    fi
done

actual_bytes="$(stat -f%z "$destination" 2>/dev/null || stat -c%s "$destination")"
[ "$actual_bytes" = "$expected_bytes" ] || { echo "Size verification failed for $model_id: $actual_bytes != $expected_bytes" >&2; exit 1; }

echo "modelId      : $model_id"
echo "path         : $destination"
echo "bytes        : $actual_bytes"
echo "verifiedSize : true"
if [ "$verify_hash" -eq 1 ]; then
    actual_sha256="$(shasum -a 256 "$destination" | cut -d' ' -f1)"
    echo "sha256       : $actual_sha256"
    if [ "$expected_sha256" != "-" ] && [ "$actual_sha256" != "$expected_sha256" ]; then
        echo "sha256 mismatch: expected $expected_sha256" >&2
        exit 1
    fi
fi
