# FilmGame Studio Configuration Map

This is the source-of-truth map for configuration placement. Never paste a `KEY=value` block into PowerShell. Put it in the exact file shown below. PowerShell is used only to create/open files and start or inspect services.

## Implemented credential chains

| Capability | Vendor secret file | FilmGame caller file | Implemented path |
| --- | --- | --- | --- |
| OpenAI / DeepSeek LLM | none; direct backend call | `G:\filmGame\filmgame-studio\.env.local` | Orchestrator -> `OpenAICompatibleLLMProvider` -> provider Chat Completions |
| Volcengine Ark / Seedance | `services\video-gateway\.env.local` | root `.env.local` uses `REMOTE_VIDEO_*` | Orchestrator -> RemoteVideoProvider -> Video Gateway -> Ark submit/poll -> temporary video URL -> immutable storage |
| ElevenLabs Music / SFX | `services\audio-gateway\.env.local` | root `.env.local` uses `REMOTE_AUDIO_*` | Orchestrator -> RemoteMusic/RemoteSfx -> Audio Gateway -> ElevenLabs -> signed temporary audio -> immutable storage |
| Cloudflare R2 / AWS S3 | `services\storage-gateway\.env.local` | root `.env.local` uses `REMOTE_STORAGE_*` | Orchestrator -> RemoteStorageProvider -> Storage Gateway -> S3 SigV4 PUT/HEAD/presigned GET |

All gateway vendor keys stay in the gateway service process. The Orchestrator only receives an internal bearer token.

## Exact files

### Root application configuration

Path: `G:\filmGame\filmgame-studio\.env.local`

Use for LLM credentials, local providers, internal gateway URLs/tokens, Orchestrator authentication, and machine paths. Start with `.env.example`.

### Seedance Video Gateway

Path: `G:\filmGame\filmgame-studio\services\video-gateway\.env.local`

Start with `services\video-gateway\.env.example`. This service consumes `ARK_API_KEY` and `ARK_VIDEO_MODEL`. Official registration and API-key entry points:

- Ark console: https://console.volcengine.com/ark/region:ark+cn-beijing
- Ark API keys: https://console.volcengine.com/ark/region:ark+cn-beijing/apikey
- Video task API: https://api.volcengine.com/api-docs/view?action=CreateContentsGenerationsTasks&serviceCode=ark&version=2024-01-01

### ElevenLabs Audio Gateway

Path: `G:\filmGame\filmgame-studio\services\audio-gateway\.env.local`

Start with `services\audio-gateway\.env.example`. This service consumes `ELEVENLABS_API_KEY`.

- Sign up: https://elevenlabs.io/app/sign-up
- API keys: https://elevenlabs.io/docs/overview/administration/workspaces/api-keys
- Music API: https://elevenlabs.io/docs/api-reference/music/compose
- Sound Effects API: https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert

### R2 / S3 Storage Gateway

Path: `G:\filmGame\filmgame-studio\services\storage-gateway\.env.local`

Start with `services\storage-gateway\.env.example`. This service consumes S3-compatible access-key credentials. Scope them to the FilmGame production bucket.

- Cloudflare registration: https://dash.cloudflare.com/sign-up
- R2 tokens: https://developers.cloudflare.com/r2/api/tokens/
- R2 S3 endpoint setup: https://developers.cloudflare.com/r2/get-started/s3/
- AWS registration: https://portal.aws.amazon.com/billing/signup
- AWS S3 security: https://docs.aws.amazon.com/AmazonS3/latest/userguide/security-best-practices.html

## Not currently requesting an API key

- LiveKit is a V2 adapter boundary and is not wired into the V1 runtime path. Leave `LIVEKIT_*` blank until the bridge and backend token endpoint are implemented.
- Steamworks uses a partner account and SteamCMD session, not an API key. Build/upload automation is a release-phase integration.
- Windows code signing uses a certificate in a hardware token, HSM, or KeyLocker, not an API key. SignTool automation remains a release-phase integration.
- VoiceGrant is structured legal/domain evidence, not an environment variable.

## Start and verify

After the three service-specific `.env.local` files and root `.env.local` are configured:

```powershell
Set-Location 'G:\filmGame\filmgame-studio'
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-local-stack.ps1 -Services video-gateway,audio-gateway,storage-gateway,orchestrator
npm run stack:status
```

Gateway defaults are bound to loopback ports 4301, 4302, and 4303. Production deployment should terminate TLS in front of each service and keep vendor secrets in a secret manager.
