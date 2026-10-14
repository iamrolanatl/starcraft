#!/usr/bin/env bash
# Cron wrapper (@reboot + watchdog every minute). Starts the escalation daemon if it isn't running
# (the daemon holds a lock, so extra starts exit at once). Keys come from chmod-600 files on the box only.
for f in "$HOME/.config/crystal/sync.env" "$HOME/.config/crystal/escalation.env"; do [ -f "$f" ] && . "$f"; done
mkdir -p "$HOME/.local/state/crystal"
pgrep -f "sync/escalation_worker.py" >/dev/null && exit 0
nohup python3 "$(dirname "$(readlink -f "$0")")/escalation_worker.py" >> "$HOME/.local/state/crystal/escalations.log" 2>&1 &
