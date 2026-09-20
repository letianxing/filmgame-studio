#!/usr/bin/env bash
# macOS/Linux counterpart of encrypt-local-secrets.ps1.
set -euo pipefail

workspace="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
sops_config="$workspace/.sops.yaml"
secret_root="$workspace/secrets"

command -v sops >/dev/null 2>&1 || { echo 'SOPS is not installed. Run: brew install sops age' >&2; exit 1; }
[ -f "$sops_config" ] || { echo "Missing SOPS config: $sops_config" >&2; exit 1; }

recipient="$(sed -n 's/.*age:[[:space:]]*\(age1[0-9a-z]*\).*/\1/p' "$sops_config" | head -1)"
[ -n "$recipient" ] || { echo 'No age recipient was found in .sops.yaml.' >&2; exit 1; }
mkdir -p "$secret_root"

sources=(.env.local apps/creator-console/.env.local services/video-gateway/.env.local services/audio-gateway/.env.local services/storage-gateway/.env.local)
names=(root creator-console video-gateway audio-gateway storage-gateway)

# Write to this platform's own ciphertext so encrypting here never clobbers another OS's
# absolute paths. Pass --shared to overwrite the cross-platform `<name>.env.enc` instead.
case "$(uname -s)" in
    Darwin) platform=macos ;;
    Linux)  platform=linux ;;
    *)      platform="" ;;
esac
[ "${1:-}" = "--shared" ] && platform=""
suffix="${platform:+.$platform}"

for i in "${!sources[@]}"; do
    source="$workspace/${sources[$i]}"
    destination="$secret_root/${names[$i]}$suffix.env.enc"
    [ -f "$source" ] || { echo "Missing plaintext configuration: $source" >&2; exit 1; }
    sops --encrypt --age "$recipient" --input-type dotenv --output-type dotenv --output "$destination" "$source"
    echo "  $source -> ${destination#"$workspace"/}"
done

echo "Encrypted ${#sources[@]} local configuration files. No plaintext was added to Git."
