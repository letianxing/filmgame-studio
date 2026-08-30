# FilmGame Studio first-party rules

This directory is the commercial, first-party source of truth.

- Treat sibling repositories and local installations as upstream dependencies or research references.
- Never copy implementation code from `../filmgame`; its README prohibits commercial use without written authorization.
- Natural language is the primary authoring interface, but structured, validated and versioned domain data is authoritative.
- LLMs may propose changes and interpret player intent. They must never mutate authoritative multiplayer state.
- All runtime mutations pass schema validation and deterministic server-side resolution.
- Story Studio depends on domain/application contracts, never directly on a concrete AI or media provider.
- Machine paths and credentials are configuration. Do not hardcode them in business code or commit secrets.
- Prefer adapter, HTTP, WebSocket, CLI and manifest boundaries over upstream source modification.
- Add focused tests for schema, dependency, versioning and resolution behavior before wiring external providers.
- Never materialize a recursive file listing for Unreal Engine, model stores, ComfyUI, caches, or other large trees. Use exact-path checks, bounded depth, streaming tools, and capped output; do not compute directory size by collecting every file object in memory.
