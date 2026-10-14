#!/usr/bin/env bash
# Cron wrapper (every 15 min): token-route Google pulls + write-back, and Eli's O365 ICS if configured. Secrets stay in ~/.config/crystal.
for f in sync google o365; do [ -f "$HOME/.config/crystal/$f.env" ] && set -a && . "$HOME/.config/crystal/$f.env" && set +a; done
D="$(dirname "$0")"; L="$HOME/.local/state/crystal"; mkdir -p "$L"
exec 9>"$L/ext_sync.lock"; flock -n 9 || exit 0
{
  python3 "$D/ext_sync.py" writeback
  if [ -n "$CRYSTAL_GOOGLE_CLIENT_ID" ]; then python3 "$D/ext_sync.py" google-tasks-api; python3 "$D/ext_sync.py" google-cal-api; fi
  [ -n "$ELI_O365_ICS_URL" ] && python3 "$D/ext_sync.py" o365-ics
  for j in "$L"/o365-inbox/*.json; do [ -f "$j" ] && python3 "$D/ext_sync.py" o365-json "$j" && mv "$j" "$j.done"; done
} >>"$L/ext_sync.log" 2>&1
