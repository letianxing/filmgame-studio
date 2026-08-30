param(
    [ValidateSet('comfyui', 'cosyvoice', 'video-gateway', 'audio-gateway', 'storage-gateway', 'orchestrator', 'multiplayer', 'creator-console', 'companion-web')]
    [string[]]$Services = @('comfyui', 'cosyvoice', 'orchestrator', 'multiplayer', 'creator-console', 'companion-web')
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$localRoot = Join-Path $workspace '.local'
$logRoot = Join-Path $localRoot 'logs'
$statePath = Join-Path $localRoot 'processes.json'
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null

function Import-LocalEnvironment {
    $environmentFile = Join-Path $workspace '.env.local'
    if (-not (Test-Path -LiteralPath $environmentFile)) { return }
    foreach ($line in Get-Content -LiteralPath $environmentFile -Encoding UTF8) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
        $parts = $trimmed.Split('=', 2)
        if ($parts.Count -eq 2) {
            [Environment]::SetEnvironmentVariable($parts[0], $parts[1], 'Process')
        }
    }
}

function Get-Listener([int]$Port) {
    return Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
        Select-Object -First 1
}

function Test-ServiceSelected([string]$Name) {
    return $Services -contains $Name
}

function Start-StackProcess {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$FilePath,
        [Parameter(Mandatory)][string[]]$ArgumentList,
        [Parameter(Mandatory)][string]$WorkingDirectory,
        [Parameter(Mandatory)][int]$Port,
        [int]$TimeoutSeconds = 180
    )

    $existing = Get-Listener $Port
    if ($existing) {
        return [pscustomobject]@{
            name = $Name; pid = [int]$existing.OwningProcess; port = $Port; state = 'existing'
        }
    }
    if (-not (Test-Path -LiteralPath $FilePath)) {
        throw "$Name executable does not exist: $FilePath"
    }
    $stdout = Join-Path $logRoot "$Name.out.log"
    $stderr = Join-Path $logRoot "$Name.err.log"
    $process = Start-Process -FilePath $FilePath -ArgumentList $ArgumentList `
        -WorkingDirectory $WorkingDirectory -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        Start-Sleep -Milliseconds 500
        if ($process.HasExited) {
            throw "$Name exited before port $Port was ready. See $stderr"
        }
        $listener = Get-Listener $Port
    } while (-not $listener -and (Get-Date) -lt $deadline)
    if (-not $listener) {
        throw "$Name did not listen on port $Port within $TimeoutSeconds seconds"
    }
    return [pscustomobject]@{
        name = $Name; pid = [int]$process.Id; port = $Port; state = 'started'
    }
}

Import-LocalEnvironment
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
$previouslyTracked = if (Test-Path -LiteralPath $statePath) {
    @(Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json)
} else { @() }
$processes = @()

if (Test-ServiceSelected 'comfyui') {
    $comfyPython = [Environment]::GetEnvironmentVariable('COMFYUI_PYTHON', 'Process')
    $comfyHome = [Environment]::GetEnvironmentVariable('COMFYUI_HOME', 'Process')
    $comfyBase = [Environment]::GetEnvironmentVariable('COMFYUI_BASE_DIRECTORY', 'Process')
    $comfyDatabasePath = (Join-Path $comfyBase 'user\comfyui.db').Replace('\', '/')
    $memoryProfile = [Environment]::GetEnvironmentVariable('COMFYUI_MEMORY_PROFILE', 'Process')
    if (-not $memoryProfile) { $memoryProfile = 'SAFE' }
    $memoryArgs = switch ($memoryProfile.ToUpperInvariant()) {
        'SAFE' { @('--lowvram', '--disable-pinned-memory', '--disable-async-offload', '--disable-dynamic-vram', '--reserve-vram', '1') }
        'BALANCED' { @('--normalvram') }
        'CPU' { @('--cpu') }
        default { throw "Unsupported COMFYUI_MEMORY_PROFILE: $memoryProfile" }
    }
    $comfyArguments = @(
        (Join-Path $comfyHome 'main.py'), '--listen', '127.0.0.1', '--port', '8188',
        '--base-directory', $comfyBase,
        '--database-url', "sqlite:///$comfyDatabasePath",
        '--disable-auto-launch', '--disable-all-custom-nodes', '--disable-api-nodes'
    ) + $memoryArgs
    $processes += Start-StackProcess -Name 'comfyui' -FilePath $comfyPython -WorkingDirectory $comfyHome -Port 8188 -ArgumentList $comfyArguments
}

if (Test-ServiceSelected 'cosyvoice') {
    $cosyPython = [Environment]::GetEnvironmentVariable('COSYVOICE_PYTHON', 'Process')
    $cosyHome = [Environment]::GetEnvironmentVariable('COSYVOICE_HOME', 'Process')
    $cosyModel = [Environment]::GetEnvironmentVariable('COSYVOICE_MODEL_DIR', 'Process')
    $processes += Start-StackProcess -Name 'cosyvoice' -FilePath $cosyPython -WorkingDirectory $workspace -Port 50000 -TimeoutSeconds 240 -ArgumentList @(
        (Join-Path $workspace 'services\cosyvoice-adapter\python\server.py'),
        '--host', '127.0.0.1', '--port', '50000', '--model-dir', $cosyModel,
        '--cosyvoice-home', $cosyHome
    )
}

if (Test-ServiceSelected 'video-gateway') {
    $processes += Start-StackProcess -Name 'video-gateway' -FilePath $npm -WorkingDirectory $workspace -Port 4301 -ArgumentList @('run', 'start:video-gateway')
}
if (Test-ServiceSelected 'audio-gateway') {
    $processes += Start-StackProcess -Name 'audio-gateway' -FilePath $npm -WorkingDirectory $workspace -Port 4302 -ArgumentList @('run', 'start:audio-gateway')
}
if (Test-ServiceSelected 'storage-gateway') {
    $processes += Start-StackProcess -Name 'storage-gateway' -FilePath $npm -WorkingDirectory $workspace -Port 4303 -ArgumentList @('run', 'start:storage-gateway')
}

if (Test-ServiceSelected 'orchestrator') {
    $processes += Start-StackProcess -Name 'orchestrator' -FilePath $npm -WorkingDirectory $workspace -Port 4100 -ArgumentList @('run', 'start:orchestrator')
}
if (Test-ServiceSelected 'multiplayer') {
    $runtimeDefinitionRoot = [Environment]::GetEnvironmentVariable('RUNTIME_DEFINITION_ROOT', 'Process')
    if ($runtimeDefinitionRoot) {
        $developmentRuntime = Join-Path $runtimeDefinitionRoot 'snowbound-hotel\runtime-v1'
        $developmentStory = Join-Path $developmentRuntime 'story.json'
        if (-not (Test-Path -LiteralPath $developmentStory)) {
            New-Item -ItemType Directory -Path $developmentRuntime -Force | Out-Null
            Copy-Item -LiteralPath (Join-Path $workspace 'examples\snowbound-hotel\story.json') -Destination $developmentStory
        }
    }
    $processes += Start-StackProcess -Name 'multiplayer' -FilePath $npm -WorkingDirectory (Join-Path $workspace 'apps\multiplayer-server') -Port 2567 -ArgumentList @('start')
}
if (Test-ServiceSelected 'creator-console') {
    $processes += Start-StackProcess -Name 'creator-console' -FilePath $npm -WorkingDirectory (Join-Path $workspace 'apps\creator-console') -Port 3000 -ArgumentList @('run', 'dev', '--', '--host', '127.0.0.1', '--port', '3000', '--strictPort')
}
if (Test-ServiceSelected 'companion-web') {
    $processes += Start-StackProcess -Name 'companion-web' -FilePath $npm -WorkingDirectory (Join-Path $workspace 'apps\companion-web') -Port 3001 -ArgumentList @('run', 'dev', '--', '--host', '127.0.0.1', '--port', '3001', '--strictPort')
}

$retained = @($previouslyTracked | Where-Object {
    -not (Test-ServiceSelected ([string]$_.name)) -and
    $null -ne (Get-Process -Id ([int]$_.pid) -ErrorAction SilentlyContinue)
})
$tracked = @($retained) + @($processes)
$tracked | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $statePath -Encoding UTF8
$processes | Format-Table -AutoSize
