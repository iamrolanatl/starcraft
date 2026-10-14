#!/usr/bin/env bash
# Self-check / boot hook. The box has no systemd (PID 1 is tini), so cron does not start on boot by itself.
# This runs from ~/.bashrc and ~/.profile (any agent shell after a reboot restarts cron) and can be run by hand.
# Prints a warning if the poller heartbeat is older than 5 minutes.
pgrep -x cron >/dev/null || sudo -n /usr/sbin/cron 2>/dev/null
hb="$HOME/.local/state/crystal/poller.heartbeat"
if [ -f "$hb" ]; then age=$(( $(date +%s) - $(stat -c %Y "$hb") )); [ "$age" -gt 300 ] && echo "crystal: poller heartbeat is ${age}s old" >&2; fi
# Escalation worker (hard chat questions): start it if dead; warn if its heartbeat is stale.
for d in /workspace/crystal-build/sync /workspace/crystal/sync; do [ -x "$d/run_escalation_worker.sh" ] && { "$d/run_escalation_worker.sh" >/dev/null 2>&1; break; }; done
ehb="$HOME/.local/state/crystal/escalation.heartbeat"
if [ -f "$ehb" ]; then age=$(( $(date +%s) - $(stat -c %Y "$ehb") )); [ "$age" -gt 120 ] && echo "crystal: escalation worker heartbeat is ${age}s old" >&2; fi
true
