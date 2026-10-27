#!/usr/bin/env bash
# Inspect one completed segment. All credentials stay in the existing service environment.
set -euo pipefail
segment="${1:?segment id required}"
case "$segment" in arrival|introductions|first-question|answer-reactions) ;; *) echo 'Unknown segment' >&2; exit 1 ;; esac
python3 scripts/director-contact-sheet.py --input "artifacts/wolong-opening/raw/$segment.mp4" --output "artifacts/wolong-opening/review/$segment" --step 1
node --env-file=.env.local -e '
const {spawn}=require("child_process");
const name=process.argv[1];
const p=spawn(process.env.COSYVOICE_PYTHON,["scripts/review-directed-audio.py","--input",`artifacts/wolong-opening/raw/${name}.mp4`,"--output",`artifacts/wolong-opening/review/${name}/asr.json`],{stdio:"inherit"});
p.on("exit",c=>process.exit(c??1));
' "$segment"
