param(
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$secretRoot = Join-Path $workspace 'secrets'

function Resolve-SopsExecutable {
    $command = Get-Command sops -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    $packageRoot = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
    $candidate = Get-ChildItem -LiteralPath $packageRoot -Filter 'sops.exe' -Recurse -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($candidate) { return $candidate.FullName }
    throw 'SOPS is not installed. Install winget package SecretsOPerationS.SOPS.'
}

$keyFile = if ($env:SOPS_AGE_KEY_FILE) {
    [IO.Path]::GetFullPath($env:SOPS_AGE_KEY_FILE)
} else {
    [IO.Path]::GetFullPath((Join-Path $env:USERPROFILE '.config\sops\age\keys.txt'))
}
if (-not (Test-Path -LiteralPath $keyFile)) {
    throw "Age private key was not found. Restore it to: $keyFile"
}
$env:SOPS_AGE_KEY_FILE = $keyFile
$sops = Resolve-SopsExecutable

$files = @(
    @{ Source = 'secrets\root.env.enc'; Destination = '.env.local' },
    @{ Source = 'secrets\creator-console.env.enc'; Destination = 'apps\creator-console\.env.local' },
    @{ Source = 'secrets\video-gateway.env.enc'; Destination = 'services\video-gateway\.env.local' },
    @{ Source = 'secrets\audio-gateway.env.enc'; Destination = 'services\audio-gateway\.env.local' },
    @{ Source = 'secrets\storage-gateway.env.enc'; Destination = 'services\storage-gateway\.env.local' }
)

foreach ($entry in $files) {
    $source = [IO.Path]::GetFullPath((Join-Path $workspace $entry.Source))
    $destination = [IO.Path]::GetFullPath((Join-Path $workspace $entry.Destination))
    if (-not $source.StartsWith($secretRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw "Unsafe encrypted source: $source"
    }
    if (-not $destination.StartsWith($workspace + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw "Unsafe plaintext destination: $destination"
    }
    if (-not (Test-Path -LiteralPath $source)) { throw "Missing encrypted configuration: $source" }
    if ((Test-Path -LiteralPath $destination) -and -not $Force) {
        throw "Refusing to overwrite existing configuration: $destination. Re-run with -Force if intentional."
    }
    & $sops --decrypt --input-type dotenv --output-type dotenv --output $destination $source
    if ($LASTEXITCODE -ne 0) { throw "SOPS decryption failed for $($entry.Source)" }
}

Write-Output "Decrypted $($files.Count) local configuration files. Plaintext remains Git-ignored."
