#!/usr/bin/env bash
# macOS/Linux counterpart of status-local-stack.ps1.
set -euo pipefail

names=(creator-console companion-web multiplayer unreal-gateway orchestrator cosyvoice comfyui)
ports=(3000 3001 2567 2568 4100 50000 8188)

printf '%-16s %-6s %-10s %s\n' "NAME" "PORT" "LISTENING" "PID"
for i in "${!names[@]}"; do
    # lsof exits non-zero when nothing listens; pipefail would otherwise abort the loop.
    pid="$(lsof -nP -iTCP:"${ports[$i]}" -sTCP:LISTEN -t 2>/dev/null | head -1 || true)"
    if [ -n "$pid" ]; then
        printf '%-16s %-6s %-10s %s\n' "${names[$i]}" "${ports[$i]}" "True" "$pid"
    else
        printf '%-16s %-6s %-10s %s\n' "${names[$i]}" "${ports[$i]}" "False" "-"
    fi
done
