$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$sopsConfig = Join-Path $workspace '.sops.yaml'
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

if (-not (Test-Path -LiteralPath $sopsConfig)) { throw "Missing SOPS config: $sopsConfig" }
$recipientMatch = Select-String -LiteralPath $sopsConfig -Pattern 'age:\s*(age1[0-9a-z]+)' |
    Select-Object -First 1
if (-not $recipientMatch) { throw 'No age recipient was found in .sops.yaml.' }
$recipient = $recipientMatch.Matches[0].Groups[1].Value
$sops = Resolve-SopsExecutable
New-Item -ItemType Directory -Path $secretRoot -Force | Out-Null

$files = @(
    @{ Source = '.env.local'; Destination = 'secrets\root.env.enc' },
    @{ Source = 'apps\creator-console\.env.local'; Destination = 'secrets\creator-console.env.enc' },
    @{ Source = 'services\video-gateway\.env.local'; Destination = 'secrets\video-gateway.env.enc' },
    @{ Source = 'services\audio-gateway\.env.local'; Destination = 'secrets\audio-gateway.env.enc' },
    @{ Source = 'services\storage-gateway\.env.local'; Destination = 'secrets\storage-gateway.env.enc' }
)

foreach ($entry in $files) {
    $source = [IO.Path]::GetFullPath((Join-Path $workspace $entry.Source))
    $destination = [IO.Path]::GetFullPath((Join-Path $workspace $entry.Destination))
    if (-not $source.StartsWith($workspace + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw "Unsafe source path: $source"
    }
    if (-not $destination.StartsWith($secretRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw "Unsafe encrypted destination: $destination"
    }
    if (-not (Test-Path -LiteralPath $source)) { throw "Missing plaintext configuration: $source" }
    & $sops --encrypt --age $recipient --input-type dotenv --output-type dotenv --output $destination $source
    if ($LASTEXITCODE -ne 0) { throw "SOPS encryption failed for $($entry.Source)" }
}

Write-Output "Encrypted $($files.Count) local configuration files. No plaintext was added to Git."
