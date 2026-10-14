#!/usr/bin/env bash
# Cron wrapper (every minute): loads the service key from ~/.config/crystal/sync.env (chmod 600, box only).
[ -f "$HOME/.config/crystal/sync.env" ] && . "$HOME/.config/crystal/sync.env"
exec python3 "$(dirname "$0")/poller.py"
