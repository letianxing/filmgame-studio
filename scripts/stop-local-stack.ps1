$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$statePath = Join-Path $workspace '.local\processes.json'
if (-not (Test-Path -LiteralPath $statePath)) {
    Write-Output 'No tracked FilmGame processes.'
    exit 0
}
$tracked = Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
$remaining = @()

function Test-FilmGameProcess(
    [Microsoft.Management.Infrastructure.CimInstance]$Process,
    [string]$TrackedName = ''
) {
    $command = [string]$Process.CommandLine
    $insideWorkspace = $command.IndexOf($workspace, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
        $command.IndexOf('filmgame\venvs\comfyui', [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
        $command.IndexOf('filmgame\venvs\cosyvoice', [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
        $command.IndexOf('G:\comfyui\resources\ComfyUI', [StringComparison]::OrdinalIgnoreCase) -ge 0
    if ($insideWorkspace) { return $true }
    if ($TrackedName -eq 'orchestrator') {
        return $command.IndexOf('run start:orchestrator', [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
            $command.IndexOf('tsx apps/orchestrator/src/server.ts', [StringComparison]::OrdinalIgnoreCase) -ge 0
    }
    if ($TrackedName -eq 'multiplayer') {
        return $command.IndexOf('npm.cmd" start', [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
            $command.IndexOf('npm-cli.js" start', [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
            $command.IndexOf('tsx src/server.ts', [StringComparison]::OrdinalIgnoreCase) -ge 0
    }
    if ($TrackedName -eq 'creator-console') {
        return $command.IndexOf('--port 3000', [StringComparison]::OrdinalIgnoreCase) -ge 0
    }
    if ($TrackedName -eq 'companion-web') {
        return $command.IndexOf('--port 3001', [StringComparison]::OrdinalIgnoreCase) -ge 0
    }
    return $false
}

function Get-ProcessTree([int]$RootPid) {
    $all = @(Get-CimInstance Win32_Process)
    $pending = [Collections.Generic.Queue[int]]::new()
    $pending.Enqueue($RootPid)
    $result = [Collections.Generic.List[Microsoft.Management.Infrastructure.CimInstance]]::new()
    while ($pending.Count -gt 0) {
        $parent = $pending.Dequeue()
        foreach ($child in $all | Where-Object { $_.ParentProcessId -eq $parent }) {
            $result.Add($child)
            $pending.Enqueue([int]$child.ProcessId)
        }
    }
    return $result
}

foreach ($entry in @($tracked)) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($entry.pid)" -ErrorAction SilentlyContinue
    if (-not $process) { continue }
    if (-not (Test-FilmGameProcess $process ([string]$entry.name))) {
        Write-Warning "Skipped PID $($entry.pid); command line is outside FilmGame scope."
        $remaining += $entry
        continue
    }
    $children = @(Get-ProcessTree ([int]$entry.pid))
    [array]::Reverse($children)
    foreach ($child in $children) {
        if (Test-FilmGameProcess $child ([string]$entry.name)) {
            Stop-Process -Id $child.ProcessId -Force -ErrorAction SilentlyContinue
        }
    }
    Stop-Process -Id $entry.pid -Force
    Write-Output "Stopped $($entry.name) (PID $($entry.pid))."
}
if ($remaining.Count) {
    $remaining | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $statePath -Encoding UTF8
} else {
    Remove-Item -LiteralPath $statePath -Force
}
