#!/usr/bin/env bash
# macOS/Linux counterpart of stop-local-stack.ps1.
# Only stops processes whose command line is demonstrably inside this workspace's stack,
# mirroring the Windows script's refusal to kill unrelated PIDs.
set -euo pipefail

workspace="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
state_path="$workspace/.local/processes.json"
if [ ! -f "$state_path" ]; then
    echo 'No tracked FilmGame processes.'
    exit 0
fi

descendants() {
    local parent="$1" child
    for child in $(pgrep -P "$parent" 2>/dev/null || true); do
        descendants "$child"
        echo "$child"
    done
}

# Identity check. Matching on `ps -o command=` alone is unreliable: npm rewrites its argv to
# a short form ("npm run start:video-gateway") that contains neither the workspace path nor
# the entry script. The stronger evidence is that this PID — or one of its children — is the
# process actually listening on the port we recorded for it when we started it.
in_scope() {
    local pid="$1" tracked_name="$2" port="$3" listener command
    [ -n "$(ps -o command= -p "$pid" 2>/dev/null || true)" ] || return 1

    if [ -n "$port" ]; then
        listener="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -1 || true)"
        if [ -n "$listener" ]; then
            [ "$listener" = "$pid" ] && return 0
            for child in $(descendants "$pid"); do
                [ "$child" = "$listener" ] && return 0
            done
        fi
    fi

    command="$(ps -o command= -p "$pid" 2>/dev/null || true)"
    case "$command" in
        *"$workspace"*) return 0 ;;
        *Golands/ComfyUI*|*Golands/CosyVoice*) return 0 ;;
    esac
    case "$tracked_name" in
        orchestrator)    case "$command" in *"start:orchestrator"*|*"apps/orchestrator/src/server.ts"*) return 0 ;; esac ;;
        video-gateway|audio-gateway|storage-gateway)
                         case "$command" in *"start:$tracked_name"*) return 0 ;; esac ;;
        multiplayer)     case "$command" in *"npm start"*|*"npm-cli.js start"*|*"tsx src/server.ts"*|*"src/server.ts"*) return 0 ;; esac ;;
        creator-console) case "$command" in *"--port 3000"*) return 0 ;; esac ;;
        companion-web)   case "$command" in *"--port 3001"*) return 0 ;; esac ;;
    esac
    return 1
}

remaining=()
while IFS=$'\t' read -r name pid port; do
    [ -n "$pid" ] || continue
    kill -0 "$pid" 2>/dev/null || continue
    if ! in_scope "$pid" "$name" "$port"; then
        echo "WARNING: Skipped PID $pid; it is neither listening on port $port nor inside FilmGame scope." >&2
        remaining+=("{\"name\":\"$name\",\"pid\":$pid,\"port\":$port}")
        continue
    fi
    # Children are killed unconditionally: they were forked by a process we just confirmed is ours.
    for child in $(descendants "$pid"); do
        kill -TERM "$child" 2>/dev/null || true
    done
    kill -TERM "$pid" 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.5
    done
    kill -0 "$pid" 2>/dev/null && kill -KILL "$pid" 2>/dev/null || true
    echo "Stopped $name (PID $pid)."
done < <(python3 -c '
import json, sys
try:
    tracked = json.load(open(sys.argv[1]))
except Exception:
    tracked = []
for entry in tracked:
    print("{}\t{}\t{}".format(entry.get("name", ""), entry.get("pid", ""), entry.get("port", "")))
' "$state_path")

if [ ${#remaining[@]} -eq 0 ]; then
    rm -f "$state_path"
else
    printf '%s\n' "${remaining[@]}" | python3 -c '
import json, sys
json.dump([json.loads(l) for l in sys.stdin if l.strip()], open(sys.argv[1], "w"), indent=2)
' "$state_path"
fi
