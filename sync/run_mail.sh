#!/usr/bin/env bash
# Wrapper for the 5-minute Gmail routine: loads keys from chmod-600 env files (never in the repo).
#   run_mail.sh ingest FILE.json | run_mail.sh outbox list|mark ... | run_mail.sh draft --pending
set -uo pipefail
for f in sync.env escalation.env; do [ -f "$HOME/.config/crystal/$f" ] && . "$HOME/.config/crystal/$f"; done
d="$(dirname "$0")"; cmd="${1:-}"; shift || true
case "$cmd" in ingest) exec python3 "$d/mail_ingest.py" "$@";; outbox) exec python3 "$d/mail_outbox.py" "$@";; draft) exec python3 "$d/mail_draft.py" "$@";; *) echo "usage: run_mail.sh ingest|outbox|draft ..." >&2; exit 64;; esac
