param(
    [Parameter(Mandatory)][string]$ModelId,
    [switch]$VerifyHash
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$registryPath = Join-Path $workspace 'config\model-registry.json'
$environmentPath = Join-Path $workspace '.env.local'

if (Test-Path -LiteralPath $environmentPath) {
    foreach ($line in Get-Content -LiteralPath $environmentPath -Encoding UTF8) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
        $parts = $trimmed.Split('=', 2)
        if ($parts.Count -eq 2) {
            [Environment]::SetEnvironmentVariable($parts[0], $parts[1], 'Process')
        }
    }
}

$baseDirectory = [Environment]::GetEnvironmentVariable('COMFYUI_BASE_DIRECTORY', 'Process')
if (-not $baseDirectory) {
    throw 'COMFYUI_BASE_DIRECTORY must be set in .env.local.'
}

$registry = Get-Content -LiteralPath $registryPath -Raw -Encoding UTF8 | ConvertFrom-Json
$model = $registry.models | Where-Object { $_.id -eq $ModelId } | Select-Object -First 1
if (-not $model) { throw "Unknown model id: $ModelId" }
if (-not $model.downloadUrl -or -not $model.relativeModelPath -or -not $model.expectedBytes) {
    throw "Model $ModelId has no downloadable binary metadata."
}

$modelRoot = [IO.Path]::GetFullPath((Join-Path $baseDirectory 'models'))
$destination = [IO.Path]::GetFullPath((Join-Path $modelRoot $model.relativeModelPath))
if (-not $destination.StartsWith($modelRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Resolved model destination escaped the configured model root.'
}
New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null

$existingBytes = if (Test-Path -LiteralPath $destination) {
    (Get-Item -LiteralPath $destination).Length
} else { 0 }
$expectedBytes = [int64]$model.expectedBytes
if ($existingBytes -gt $expectedBytes) {
    throw "Existing file is larger than expected: $existingBytes > $expectedBytes"
}
if ($existingBytes -lt $expectedBytes) {
    Write-Host "Resuming $ModelId at $existingBytes / $expectedBytes bytes"
    & curl.exe --fail --location --continue-at - --retry 8 --retry-all-errors `
        --output $destination ([string]$model.downloadUrl)
    if ($LASTEXITCODE -ne 0) { throw "curl failed with exit code $LASTEXITCODE" }
}

$actualBytes = (Get-Item -LiteralPath $destination).Length
if ($actualBytes -ne $expectedBytes) {
    throw "Size verification failed for $ModelId`: $actualBytes != $expectedBytes"
}

$result = [ordered]@{
    modelId = $ModelId
    path = $destination
    bytes = $actualBytes
    verifiedSize = $true
}
if ($VerifyHash) {
    $result.sha256 = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
}
[pscustomobject]$result | Format-List
