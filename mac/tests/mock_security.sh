#!/bin/sh
# Fake macOS `security` for tests: find-generic-password -s SERVICE [-w]
svc=""; w=0
while [ $# -gt 0 ]; do case "$1" in -s) svc=$2; shift;; -w) w=1;; esac; shift; done
case "$svc" in
  crystal-parentvue) if [ $w = 1 ]; then echo "mock-pass<&>"; else echo '    "acct"<blob>="mockparent"'; fi;;
  crystal-agent-secret) echo "mock-secret-0123456789012345678901234567890123456789";;
  *) exit 44;;
esac
