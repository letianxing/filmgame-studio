# Remote Media Provider Contract

Story Studio and the Production Orchestrator never call vendor APIs directly. A remote adapter translates Kling, Veo, Seedance, a GPU farm, or an audio model into this first-party contract.

## Common requirements

- Base URL must use HTTP(S).
- Authentication is an optional bearer token supplied through environment configuration.
- Every submission receives the first-party `idempotencyKey`; adapters must return the same logical generation for retries.
- Poll responses must not expose vendor credentials.
- Successful assets use a time-limited HTTPS URL or another URI the configured StorageProvider can retrieve.
- The Orchestrator immediately copies successful output into immutable storage and records SHA-256.
- Provider usage may contain `estimatedCost`; it is persisted in the Production Job output.

## Video

`POST /v1/video/generations`

```json
{
  "model": "provider-model-id",
  "request": {
    "prompt": "...",
    "negativePrompt": "...",
    "durationSeconds": 8,
    "firstFrameUri": "https://...",
    "referenceAssetUris": [],
    "workflowId": "...",
    "seed": 1
  },
  "context": {
    "requestId": "...",
    "projectId": "...",
    "storyVersion": 1,
    "productionVersion": 1,
    "idempotencyKey": "..."
  }
}
```

Response: `{ "generationId": "..." }`.

`GET /v1/video/generations/{generationId}` returns `QUEUED`, `RUNNING`, `FAILED`, `CANCELLED`, or:

```json
{
  "status": "SUCCEEDED",
  "asset": {
    "temporaryUri": "https://.../shot.mp4",
    "mimeType": "video/mp4",
    "sizeBytes": 123,
    "durationSeconds": 8
  },
  "usage": [
    { "unit": "SECONDS", "input": 0, "output": 8, "currency": "USD", "estimatedCost": 0.8 }
  ],
  "providerMetadata": { "upstreamRequestId": "..." }
}
```

## Music and SFX

`POST /v1/audio/generations` uses the same lifecycle and adds `kind: "MUSIC" | "SFX"`. Poll with `GET /v1/audio/generations/{generationId}`. Successful assets should be WAV or another FFmpeg-readable audio format.

## Health

Both services expose `GET /health` and return a successful HTTP status only when they can accept work. Model/license/capacity admission belongs in the adapter deployment, while final commercial approval remains a FilmGame release gate.

## Object storage gateway

The optional remote StorageProvider uses `PUT /v1/objects/{key}` with the binary request body and these headers:

- `content-type`
- `x-filmgame-idempotency-key`
- `x-filmgame-request-id`

It returns `{ uri, sha256, sizeBytes, contentType }`. The SHA-256 value contains 64 lowercase hexadecimal characters without a prefix. `POST /v1/objects/{key}/signed-read` accepts `{ expiresInSeconds }` and returns an HTTPS URI. This gateway can wrap R2, S3, or another commercial object store without exposing credentials to the Orchestrator.
