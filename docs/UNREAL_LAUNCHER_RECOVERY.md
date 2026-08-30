# Unreal Engine Launcher registration recovery

Recovered and verified on 2026-08-30.

## Root cause

- `G:\Epic Games\UE_5.7` exists.
- `UnrealEditor.exe`, UnrealBuildTool, AutomationTool and `.egstore` manifests exist.
- `Engine\Build\Build.version` reports 5.7.4, changelist 51494982.
- The legacy `.item` initially identified UE 5.7.4, but Launcher 20.2.4 then ran EOSH reconciliation against the
  per-user `EpicOnlineServicesShared` installation database. That database did not contain UE 5.7, so Launcher
  deleted the legacy `.item` and showed **Install**.
- `C:\ProgramData\Epic\EpicOnlineServices\...` and
  `C:\ProgramData\Epic\EpicOnlineServicesShared\...` are different databases. UE Launcher products use the
  latter; this distinction caused the earlier static repair to be ignored.

The Engine files were never removed.

## Recovery performed

1. Moved the complete engine to `UE_5.7.filmgame-existing` on the same G: volume without copying or deleting it.
2. Let Epic Launcher create a real UE 5.7.4 installation and Shared EOSH record.
3. Paused after the pending manifest and resume metadata were durable.
4. Restored the complete engine at `G:\Epic Games\UE_5.7` and transplanted the Launcher-created `.egstore`.
5. Confirmed the old and new 32,964,078-byte manifests were byte-identical with SHA-256
   `43c743ac8d0d5d429761c47b88dadd36242e53134457743a087fca85fc238e19`.
6. Reused that manifest under the new Installation ID. Launcher then reduced the repair to 137 changed files,
   downloaded/rebuilt them, and committed the installation.

## Final verification

- Main Installation ID: `A4CA07F734134A48A91DA514A3CA0A7`.
- Shared EOSH reports `UE_5.7`, `QuixelBridge_5.7` and `FabPlugin_5.7` as `Installed`.
- Launcher product response reports `isInstalled=true` and version
  `5.7.4-51494982+++UE5+Release-5.7-Windows`.
- Install location is `G:\Epic Games\UE_5.7`.
- The main `.item` persists after a Launcher restart.
- Epic's registered `com.epicgames.launcher` protocol launched the exact executable at
  `G:\Epic Games\UE_5.7\Engine\Binaries\Win64\UnrealEditor.exe`.
- The smoke-launched Editor process was stopped after path verification.
- Original registration and engine manifest backups are retained at
  `G:\filmGame\epic-registration-backup-20260830-ue57`.

## Safety rules

1. Do not delete, move, reinstall or overwrite `G:\Epic Games\UE_5.7` merely because a future Launcher UI loses its record.
2. Do not re-run recursive whole-engine size scans; use exact file checks and bounded discovery.
3. Back up Launcher registration data before any repair.
4. The authoritative Launcher registration is now the Shared EOSH entry plus the generated `.item`; do not edit it
   manually while Launcher or InstallHelper is running.
5. Preserve the recovery backup until a future Launcher update and another launch smoke both succeed.

## Independent build status

The Launcher registration issue does not block direct builds. Visual Studio Build Tools 2022 17.14.39, MSVC
14.44, Windows SDK 10.0.26100.0 and .NET Framework SDK 4.8 are installed. Editor and Shipping compilation,
headless map loading, BuildCookRun, Cook, Pak/IoStore, Archive and packaged launch have all succeeded. See
`UNREAL_BUILD_REPORT.md` for exact evidence and artifact hashes.
