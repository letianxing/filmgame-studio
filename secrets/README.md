# Encrypted local configuration

This directory contains SOPS-encrypted copies of FilmGame's local environment files. Encrypted files may be committed; plaintext `.env.local` files and the age private key must never be committed.

## Encrypted file map

| Encrypted file | Decrypted destination |
| --- | --- |
| `root.env.enc` | `.env.local` |
| `creator-console.env.enc` | `apps/creator-console/.env.local` |
| `video-gateway.env.enc` | `services/video-gateway/.env.local` |
| `audio-gateway.env.enc` | `services/audio-gateway/.env.local` |
| `storage-gateway.env.enc` | `services/storage-gateway/.env.local` |

## Per-platform copies

These files hold machine-specific absolute paths (`COMFYUI_*`, `COSYVOICE_*`, `UNREAL_*`,
`FFMPEG_PATH`, everything under `.local/`) that cannot be shared across operating systems —
a Windows `G:\...` path is meaningless on macOS and vice versa. Each platform therefore keeps
its own ciphertext:

| Platform | Files | Written by |
| --- | --- | --- |
| Windows | `<name>.env.enc` | `scripts/encrypt-local-secrets.ps1` |
| macOS | `<name>.macos.env.enc` | `scripts/encrypt-local-secrets.sh` |
| Linux | `<name>.linux.env.enc` | `scripts/encrypt-local-secrets.sh` |

`decrypt-local-secrets.sh` prefers `<name>.<platform>.env.enc` and falls back to the shared
`<name>.env.enc` with a warning on stderr. The Windows script is unchanged and always reads
`<name>.env.enc`, so encrypting on one machine never clobbers another's paths.

To deliberately overwrite the shared Windows-facing copies from a Unix machine:

```bash
bash scripts/encrypt-local-secrets.sh --shared
```

All copies are encrypted to the same age recipient, so one `keys.txt` opens all of them.

## Private key

Key paths:

```text
Windows      %USERPROFILE%\.config\sops\age\keys.txt
macOS/Linux  ~/.config/sops/age/keys.txt        (chmod 600)
```

Back up this file in a password manager or another encrypted, offline location. Losing it makes the committed secrets unrecoverable. Anyone who obtains it can decrypt the production credentials.

The private key must not be placed anywhere under this repository and must not be sent through chat, email, or an issue tracker.

## New computer recovery

1. Install SOPS and age.
2. Restore `keys.txt` to the default path above, or set `SOPS_AGE_KEY_FILE` to its protected location.
3. Clone this repository.
4. Run:

```bash
npm run secrets:decrypt
```

The command refuses to overwrite existing `.env.local` files. To intentionally replace them:

```bash
npm run secrets:decrypt -- -Force      # Windows
npm run secrets:decrypt -- --force     # macOS / Linux
```

After changing any local secret, refresh this platform's encrypted copies and commit only
the ciphertext:

```bash
npm run secrets:encrypt
git add .sops.yaml secrets scripts/encrypt-local-secrets.* scripts/decrypt-local-secrets.*
```
