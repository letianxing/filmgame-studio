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

## Private key

The default Windows key path is:

```text
%USERPROFILE%\.config\sops\age\keys.txt
```

Back up this file in a password manager or another encrypted, offline location. Losing it makes the committed secrets unrecoverable. Anyone who obtains it can decrypt the production credentials.

The private key must not be placed anywhere under this repository and must not be sent through chat, email, or an issue tracker.

## New computer recovery

1. Install SOPS and age.
2. Restore `keys.txt` to the default path above, or set `SOPS_AGE_KEY_FILE` to its protected location.
3. Clone this repository.
4. Run:

```powershell
npm run secrets:decrypt
```

The command refuses to overwrite existing `.env.local` files. To intentionally replace them:

```powershell
npm run secrets:decrypt -- -Force
```

After changing any local secret, refresh the encrypted copies and commit only the ciphertext:

```powershell
npm run secrets:encrypt
git add .sops.yaml secrets scripts/encrypt-local-secrets.ps1 scripts/decrypt-local-secrets.ps1
```
