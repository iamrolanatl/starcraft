#!/usr/bin/env bash
# Self-check / boot hook. The box has no systemd (PID 1 is tini), so cron does not start on boot by itself.
# This runs from ~/.bashrc and ~/.profile (any agent shell after a reboot restarts cron) and can be run by hand.
# Prints a warning if the poller heartbeat is older than 5 minutes.
pgrep -x cron >/dev/null || sudo -n /usr/sbin/cron 2>/dev/null
hb="$HOME/.local/state/crystal/poller.heartbeat"
if [ -f "$hb" ]; then age=$(( $(date +%s) - $(stat -c %Y "$hb") )); [ "$age" -gt 300 ] && echo "crystal: poller heartbeat is ${age}s old" >&2; fi
true
