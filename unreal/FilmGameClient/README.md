# FilmGame Unreal Runtime Client

Unreal Engine 5.7.4 runtime client for packaged multiplayer interactive films.

The client:

- loads a versioned Runtime Package and Asset Manifest;
- connects through the first-party Unreal Runtime Gateway;
- receives public snapshots and role-private state;
- submits `ready`, bot-fill and role-action intents;
- never resolves rules or mutates authoritative state locally;
- exposes snapshot/private-state delegates to Blueprint UI and Media Framework playback.

Machine paths do not live in project source. Configure the engine root and build tools through the workspace
environment/configuration. Runtime endpoints are in `Config/DefaultGame.ini` and may be overridden per build.

