#!/usr/bin/env bash
# macOS/Linux counterpart of start-local-stack.ps1.
# Same contract: port-based idempotency, logs under .local/logs, tracked PIDs in .local/processes.json.
set -euo pipefail

workspace="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
local_root="$workspace/.local"
log_root="$local_root/logs"
state_path="$local_root/processes.json"
mkdir -p "$log_root"

default_services=(comfyui cosyvoice orchestrator multiplayer creator-console companion-web)
known_services=(comfyui cosyvoice video-gateway audio-gateway storage-gateway orchestrator multiplayer creator-console companion-web)

services=()
while [ $# -gt 0 ]; do
    case "$1" in
        -Services|--services)
            IFS=',' read -r -a services <<< "$2"
            shift 2
            ;;
        *)
            services+=("$1")
            shift
            ;;
    esac
done
[ ${#services[@]} -eq 0 ] && services=("${default_services[@]}")

for name in "${services[@]}"; do
    found=0
    for known in "${known_services[@]}"; do [ "$name" = "$known" ] && found=1; done
    [ "$found" -eq 1 ] || { echo "Unknown service: $name" >&2; exit 1; }
done

import_local_environment() {
    local file="$workspace/.env.local"
    [ -f "$file" ] || return 0
    while IFS= read -r line || [ -n "$line" ]; do
        case "$line" in ''|\#*) continue ;; esac
        [[ "$line" == *=* ]] || continue
        export "${line%%=*}=${line#*=}"
    done < "$file"
}

# lsof exits non-zero when nothing listens; pipefail would otherwise abort the caller.
listener_pid() { lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | head -1 || true; }

selected() { for s in "${services[@]}"; do [ "$s" = "$1" ] && return 0; done; return 1; }

started_json=()

start_stack_process() {
    local name="$1" port="$2" workdir="$3" timeout="$4"; shift 4
    local existing; existing="$(listener_pid "$port")"
    if [ -n "$existing" ]; then
        started_json+=("{\"name\":\"$name\",\"pid\":$existing,\"port\":$port,\"state\":\"existing\"}")
        printf '%-16s %-6s %-8s %s\n' "$name" "$port" "existing" "$existing"
        return 0
    fi
    [ -x "$1" ] || command -v "$1" >/dev/null 2>&1 || { echo "$name executable does not exist: $1" >&2; exit 1; }
    # `exec` replaces the subshell with the service itself, so $! is the real PID and the
    # service does not keep this script's inherited stdout pipe open (which would hang callers).
    ( cd "$workdir" && exec "$@" >"$log_root/$name.out.log" 2>"$log_root/$name.err.log" </dev/null ) &
    local pid=$!
    disown "$pid" 2>/dev/null || true
    local waited=0
    while [ "$waited" -lt "$timeout" ]; do
        sleep 1; waited=$((waited + 1))
        kill -0 "$pid" 2>/dev/null || { echo "$name exited before port $port was ready. See $log_root/$name.err.log" >&2; exit 1; }
        [ -n "$(listener_pid "$port")" ] && break
    done
    [ -n "$(listener_pid "$port")" ] || { echo "$name did not listen on port $port within ${timeout}s" >&2; exit 1; }
    started_json+=("{\"name\":\"$name\",\"pid\":$pid,\"port\":$port,\"state\":\"started\"}")
    printf '%-16s %-6s %-8s %s\n' "$name" "$port" "started" "$pid"
}

import_local_environment
npm_bin="$(command -v npm)"
printf '%-16s %-6s %-8s %s\n' "NAME" "PORT" "STATE" "PID"

if selected comfyui; then
    comfy_base="${COMFYUI_BASE_DIRECTORY:?COMFYUI_BASE_DIRECTORY must be set in .env.local}"
    mkdir -p "$comfy_base"/{custom_nodes,input,output,temp,user}
    # --normalvram was removed in ComfyUI 0.36.0; BALANCED therefore means "engine defaults".
    # On Apple Silicon VRAM is unified system RAM, so the Windows reserve/pinned-memory knobs are no-ops.
    case "${COMFYUI_MEMORY_PROFILE:-SAFE}" in
        SAFE) memory_args=(--lowvram) ;;
        BALANCED) memory_args=() ;;
        CPU) memory_args=(--cpu) ;;
        *) echo "Unsupported COMFYUI_MEMORY_PROFILE: ${COMFYUI_MEMORY_PROFILE}" >&2; exit 1 ;;
    esac
    start_stack_process comfyui 8188 "${COMFYUI_HOME:?}" 300 \
        "${COMFYUI_PYTHON:?}" "${COMFYUI_HOME}/main.py" \
        --listen 127.0.0.1 --port 8188 \
        --base-directory "$comfy_base" \
        --database-url "sqlite:///$comfy_base/user/comfyui.db" \
        --disable-auto-launch --disable-all-custom-nodes --disable-api-nodes \
        "${memory_args[@]}"
fi

if selected cosyvoice; then
    start_stack_process cosyvoice 50000 "$workspace" 300 \
        "${COSYVOICE_PYTHON:?}" "$workspace/services/cosyvoice-adapter/python/server.py" \
        --host 127.0.0.1 --port 50000 \
        --model-dir "${COSYVOICE_MODEL_DIR:?}" --cosyvoice-home "${COSYVOICE_HOME:?}"
fi

selected video-gateway   && start_stack_process video-gateway   4301 "$workspace" 180 "$npm_bin" run start:video-gateway
selected audio-gateway   && start_stack_process audio-gateway   4302 "$workspace" 180 "$npm_bin" run start:audio-gateway
selected storage-gateway && start_stack_process storage-gateway 4303 "$workspace" 180 "$npm_bin" run start:storage-gateway
selected orchestrator    && start_stack_process orchestrator    4100 "$workspace" 180 "$npm_bin" run start:orchestrator

if selected multiplayer; then
    if [ -n "${RUNTIME_DEFINITION_ROOT:-}" ]; then
        development_runtime="$RUNTIME_DEFINITION_ROOT/snowbound-hotel/runtime-v1"
        if [ ! -f "$development_runtime/story.json" ]; then
            mkdir -p "$development_runtime"
            cp "$workspace/examples/snowbound-hotel/story.json" "$development_runtime/story.json"
        fi
    fi
    start_stack_process multiplayer 2567 "$workspace/apps/multiplayer-server" 180 "$npm_bin" start
fi

selected creator-console && start_stack_process creator-console 3000 "$workspace/apps/creator-console" 180 "$npm_bin" run dev -- --host 127.0.0.1 --port 3000 --strictPort
selected companion-web   && start_stack_process companion-web   3001 "$workspace/apps/companion-web"   180 "$npm_bin" run dev -- --host 127.0.0.1 --port 3001 --strictPort

# Merge: services started here, plus still-alive entries this invocation did not manage.
printf '%s\n' "${started_json[@]-}" | python3 -c '
import json, os, sys
state = sys.argv[1]
managed = set(sys.argv[2:])
started = [json.loads(l) for l in sys.stdin if l.strip()]
try:
    tracked = json.load(open(state))
except Exception:
    tracked = []
retained = []
for entry in tracked:
    if entry.get("name") in managed:
        continue
    try:
        os.kill(int(entry["pid"]), 0)
    except OSError:
        continue
    retained.append(entry)
json.dump(retained + started, open(state, "w"), indent=2)
' "$state_path" "${services[@]}"
