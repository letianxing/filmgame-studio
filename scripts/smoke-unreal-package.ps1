param(
    [string]$PackageRoot = '',
    [ValidateRange(1, 60)]
    [int]$ObservationSeconds = 15
)

$ErrorActionPreference = 'Stop'

$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
if (-not $PackageRoot) {
    $PackageRoot = Join-Path $workspace '.local\releases\FilmGameClient-Win64\Windows'
}
$packageRootPath = [IO.Path]::GetFullPath($PackageRoot).TrimEnd('\')
$executable = [IO.Path]::GetFullPath((Join-Path $packageRootPath 'FilmGameClient.exe'))
if (-not $executable.StartsWith($packageRootPath + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw "Executable escaped package root: $executable"
}
if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
    throw "Packaged executable not found: $executable"
}

$process = $null
$selfTerminated = $false
$exitCode = $null
$workingSetMiB = 0
$observed = $false
try {
    $process = Start-Process `
        -FilePath $executable `
        -ArgumentList @('-nullrhi', '-nosound', '-unattended', '-NoSplash') `
        -WindowStyle Hidden `
        -PassThru
    Start-Sleep -Seconds $ObservationSeconds
    $process.Refresh()
    $selfTerminated = $process.HasExited
    if ($selfTerminated) {
        $exitCode = $process.ExitCode
        if ($exitCode -ne 0) {
            throw "Packaged client exited during observation with code $exitCode"
        }
    }
    else {
        $workingSetMiB = [math]::Round($process.WorkingSet64 / 1MB, 1)
    }
    $observed = $true
}
finally {
    if ($process -and -not $process.HasExited) {
        $running = Get-CimInstance Win32_Process -Filter "ProcessId=$($process.Id)"
        $runningExecutable = if ($running) { [IO.Path]::GetFullPath($running.ExecutablePath) } else { '' }
        if ($runningExecutable -ne $executable) {
            throw "Refusing to stop unexpected process $($process.Id) at $runningExecutable"
        }
        Stop-Process -Id $process.Id -Force
        Wait-Process -Id $process.Id -Timeout 10 -ErrorAction SilentlyContinue
    }
}

if (-not $observed) {
    throw 'Packaged client was not observed successfully'
}

[pscustomobject]@{
    executable = $executable
    observationSeconds = $ObservationSeconds
    selfTerminated = $selfTerminated
    exitCode = $exitCode
    workingSetMiB = $workingSetMiB
    processCleaned = -not [bool](Get-Process -Id $process.Id -ErrorAction SilentlyContinue)
} | ConvertTo-Json -Compress
