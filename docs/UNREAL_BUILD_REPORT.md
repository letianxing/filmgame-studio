# Unreal Build Report

Verified: 2026-08-30

## Toolchain

- Unreal Engine: 5.7.4, changelist 51494982
- Visual Studio Build Tools: 2022 17.14.39
- MSVC: 14.44.35228 (`14.44.35207` tool directory)
- Windows SDK: 10.0.26100.0
- .NET Framework SDK: 4.8
- AutomationTool: `Engine/Binaries/DotNET/AutomationTool/AutomationTool.exe`

## Verification

- `FilmGameClientEditor Win64 Development`: succeeded, 10/10 actions.
- Headless `UnrealEditor-Cmd` with NullRHI loaded the FilmGameClient module and Entry map; Map Check reported 0 errors and 0 warnings.
- `FilmGameClient Win64 Shipping`: succeeded, 13/13 actions.
- `BuildCookRun`: Build, single-process Cook, Stage, Pak/IoStore and Archive succeeded with AutomationTool ExitCode 0.
- Cook processed 441 packages, reported 0 errors and 0 warnings, and kept at least 2 GiB free physical/virtual memory by policy.
- The archived executable launched under NullRHI/unattended and remained alive without a crash for the 60-second smoke window. The Shipping target did not honor either `ExecCmds=Quit` or benchmark timed-exit flags, so the harness verified the executable path and terminated the exact PID; no packaged client process was left running. Automated graceful-exit behavior remains a runtime QA item, not a BuildCookRun failure.
- `npm run smoke:unreal-package` now implements the repeatable launch observation and exact-PID cleanup boundary so future smoke runs cannot silently leave a client process behind.

## Release artifact integrity

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `FilmGameClient.exe` | 164864 | `646a661e2db73a9664c72daf4ef274addaab47b12210d648bc8c537cf36accda` |
| `FilmGameClient-Windows.pak` | 10228933 | `0bf00c64880523415379aaf1f10aa00db9c72a11b1f72cf89a8c212b37311850` |
| `FilmGameClient-Windows.ucas` | 123950096 | `fdedc9910e299fdf286c1a1b811a3d66f15bc228c507671c7e0f996839a5cb8f` |

The archive is a verified runtime shell and transport client. Commercial release remains gated on approved generated media, runtime package approval, signing, Steam configuration and store QA.
