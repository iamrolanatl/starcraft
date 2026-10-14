#!/usr/bin/env bash
# Cron wrapper: loads the service key from a chmod-600 env file on the box (never in the repo).
set -uo pipefail
[ -f "$HOME/.config/crystal/sync.env" ] && . "$HOME/.config/crystal/sync.env"
exec python3 "$(dirname "$0")/school_sync.py" "$@"
