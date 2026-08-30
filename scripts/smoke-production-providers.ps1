$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))

function Read-EnvironmentFile([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { throw "Missing configuration file: $Path" }
    $values = @{}
    foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
        $parts = $trimmed.Split('=', 2)
        if ($parts.Count -eq 2) { $values[$parts[0]] = $parts[1] }
    }
    return $values
}

function Require-Value($Values, [string]$Name, [string]$File) {
    $value = [string]$Values[$Name]
    if (-not $value -or $value.Contains('<') -or $value.Contains('example.com')) {
        throw "$Name is missing or still a placeholder in $File"
    }
    return $value
}

function Test-Gateway([string]$Name, [string]$BaseUrl, [string]$Token) {
    $headers = @{ Authorization = "Bearer $Token" }
    $response = Invoke-RestMethod -Method Get -Uri "$($BaseUrl.TrimEnd('/'))/health" -Headers $headers -TimeoutSec 15
    if ($response.status -ne 'HEALTHY') { throw "$Name health is not HEALTHY" }
    return [pscustomobject]@{ provider = $Name; baseUrl = $BaseUrl; status = 'HEALTHY' }
}

$rootPath = Join-Path $workspace '.env.local'
$videoPath = Join-Path $workspace 'services\video-gateway\.env.local'
$audioPath = Join-Path $workspace 'services\audio-gateway\.env.local'
$storagePath = Join-Path $workspace 'services\storage-gateway\.env.local'
$root = Read-EnvironmentFile $rootPath
$video = Read-EnvironmentFile $videoPath
$audio = Read-EnvironmentFile $audioPath
$storage = Read-EnvironmentFile $storagePath

$videoBase = Require-Value $root 'REMOTE_VIDEO_BASE_URL' $rootPath
$videoToken = Require-Value $root 'REMOTE_VIDEO_API_TOKEN' $rootPath
$audioBase = Require-Value $root 'REMOTE_AUDIO_BASE_URL' $rootPath
$audioToken = Require-Value $root 'REMOTE_AUDIO_API_TOKEN' $rootPath
$storageBase = Require-Value $root 'REMOTE_STORAGE_BASE_URL' $rootPath
$storageToken = Require-Value $root 'REMOTE_STORAGE_API_TOKEN' $rootPath

if ($videoToken -ne (Require-Value $video 'FILMGAME_VIDEO_GATEWAY_TOKEN' $videoPath)) { throw 'Video internal tokens do not match.' }
if ($audioToken -ne (Require-Value $audio 'FILMGAME_AUDIO_GATEWAY_TOKEN' $audioPath)) { throw 'Audio internal tokens do not match.' }
if ($storageToken -ne (Require-Value $storage 'FILMGAME_STORAGE_GATEWAY_TOKEN' $storagePath)) { throw 'Storage internal tokens do not match.' }

Require-Value $video 'ARK_API_KEY' $videoPath | Out-Null
Require-Value $video 'ARK_VIDEO_MODEL' $videoPath | Out-Null
Require-Value $audio 'ELEVENLABS_API_KEY' $audioPath | Out-Null
Require-Value $storage 'STORAGE_S3_ACCESS_KEY_ID' $storagePath | Out-Null
Require-Value $storage 'STORAGE_S3_SECRET_ACCESS_KEY' $storagePath | Out-Null

@(
    Test-Gateway 'Seedance Video Gateway' $videoBase $videoToken
    Test-Gateway 'ElevenLabs Audio Gateway' $audioBase $audioToken
    Test-Gateway 'R2/S3 Storage Gateway' $storageBase $storageToken
) | Format-Table -AutoSize
