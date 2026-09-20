#!/usr/bin/env bash
# macOS/Linux counterpart of decrypt-local-secrets.ps1.
set -euo pipefail

force=0
[ "${1:-}" = "-Force" ] || [ "${1:-}" = "--force" ] && force=1

workspace="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
secret_root="$workspace/secrets"

command -v sops >/dev/null 2>&1 || { echo 'SOPS is not installed. Run: brew install sops age' >&2; exit 1; }

key_file="${SOPS_AGE_KEY_FILE:-$HOME/.config/sops/age/keys.txt}"
[ -f "$key_file" ] || { echo "Age private key was not found. Restore it to: $key_file" >&2; exit 1; }
export SOPS_AGE_KEY_FILE="$key_file"

names=(root creator-console video-gateway audio-gateway storage-gateway)
destinations=(.env.local apps/creator-console/.env.local services/video-gateway/.env.local services/audio-gateway/.env.local services/storage-gateway/.env.local)

# Machine-specific absolute paths (COMFYUI_*, COSYVOICE_*, UNREAL_*, FFMPEG_PATH, .local/*)
# cannot be shared across operating systems, so each platform keeps its own ciphertext.
# `<name>.<platform>.env.enc` wins when present; `<name>.env.enc` is the shared fallback.
case "$(uname -s)" in
    Darwin) platform=macos ;;
    Linux)  platform=linux ;;
    *)      platform="" ;;
esac

for i in "${!names[@]}"; do
    source=""
    if [ -n "$platform" ] && [ -f "$secret_root/${names[$i]}.$platform.env.enc" ]; then
        source="$secret_root/${names[$i]}.$platform.env.enc"
    elif [ -f "$secret_root/${names[$i]}.env.enc" ]; then
        source="$secret_root/${names[$i]}.env.enc"
        echo "NOTE: no ${platform:-platform}-specific ciphertext for ${names[$i]}; using the shared one." >&2
    fi
    destination="$workspace/${destinations[$i]}"
    [ -n "$source" ] || { echo "Missing encrypted configuration for ${names[$i]} in $secret_root" >&2; exit 1; }
    if [ -e "$destination" ] && [ "$force" -eq 0 ]; then
        echo "Refusing to overwrite existing configuration: $destination. Re-run with --force if intentional." >&2
        exit 1
    fi
    mkdir -p "$(dirname "$destination")"
    sops --decrypt --input-type dotenv --output-type dotenv --output "$destination" "$source"
    chmod 600 "$destination"
done

echo "Decrypted ${#names[@]} local configuration files. Plaintext remains Git-ignored."
echo "NOTE: absolute paths inside these files come from whichever machine last ran secrets:encrypt"
echo "      for this platform. Review .env.local before starting the stack."
