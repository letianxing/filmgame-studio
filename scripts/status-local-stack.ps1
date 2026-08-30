$ErrorActionPreference = 'Stop'
$ports = [ordered]@{
    'creator-console' = 3000
    'companion-web' = 3001
    'multiplayer' = 2567
    'unreal-gateway' = 2568
    'orchestrator' = 4100
    'cosyvoice' = 50000
    'comfyui' = 8188
}
$status = foreach ($entry in $ports.GetEnumerator()) {
    $listener = Get-NetTCPConnection -State Listen -LocalPort $entry.Value -ErrorAction SilentlyContinue |
        Select-Object -First 1
    [pscustomobject]@{
        name = $entry.Key
        port = $entry.Value
        listening = [bool]$listener
        pid = if ($listener) { [int]$listener.OwningProcess } else { $null }
    }
}
$status | Format-Table -AutoSize

