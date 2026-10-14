#!/bin/sh
# install.sh - set up the Crystal school sync on this Mac. Safe to re-run (updates scripts, keeps or replaces secrets).
#   ./install.sh              install; asks whether this Mac should be the PRIMARY agent (runs the 5:40 pulls)
#   ./install.sh --no-test    skip the test pull at the end
set -eu
SRC=$(cd "$(dirname "$0")" && pwd)
APP="$HOME/Library/Application Support/Crystal"
BIN="$APP/bin"
LOGS="$HOME/Library/Logs/Crystal"
LA="$HOME/Library/LaunchAgents"
UID_N=$(id -u)
TEST=1
[ "${1:-}" = "--no-test" ] && TEST=0

[ "$(uname -s)" = "Darwin" ] || { echo "This installer is for macOS."; exit 1; }
command -v /usr/bin/python3 >/dev/null 2>&1 || { echo "python3 missing: run  xcode-select --install  then re-run."; exit 1; }
/usr/bin/python3 -c 'import sys' 2>/dev/null || { echo "Finish the Command Line Tools install, then re-run."; exit 1; }

mkdir -p "$BIN" "$LOGS" "$LA" "$APP/raw"
chmod 700 "$APP"
cp "$SRC/crystal_sync.py" "$SRC/supabase-agent.json" "$BIN/"
chmod 755 "$BIN/crystal_sync.py"

ask_secret() { # $1 prompt -> stdout
  printf '%s' "$1" >&2; stty -echo; IFS= read -r v; stty echo; printf '\n' >&2; printf '%s' "$v"
}
have() { security find-generic-password -s "$1" >/dev/null 2>&1; }

echo "== Keychain =="
if have crystal-parentvue; then
  printf 'ParentVUE login already in Keychain. Replace it? [y/N] '; read -r a
else a=y; fi
case "$a" in [yY]*)
  printf 'ParentVUE username: '; IFS= read -r PVU
  PVP=$(ask_secret 'ParentVUE password: ')
  [ -n "$PVU" ] && [ -n "$PVP" ] || { echo "empty username/password"; exit 1; }
  security add-generic-password -U -s crystal-parentvue -a "$PVU" -l "Crystal ParentVUE" -w "$PVP" -T /usr/bin/security
  PVP=; echo "saved ParentVUE login";;
esac
if have crystal-agent-secret; then
  printf 'Agent secret already in Keychain. Replace it? [y/N] '; read -r a
else a=y; fi
case "$a" in [yY]*)
  SEC=$(ask_secret 'Agent secret (same as agent-secret.txt on the Windows laptop): ')
  [ "${#SEC}" -ge 40 ] || { echo "that secret looks too short"; exit 1; }
  security add-generic-password -U -s crystal-agent-secret -a crystal -l "Crystal agent secret" -w "$SEC" -T /usr/bin/security
  SEC=; echo "saved agent secret";;
esac

echo "== Primary agent =="
echo "Only ONE computer may run the scheduled pulls (one ParentVUE login per run)."
echo "Make this Mac the primary agent? Only answer y after turning the Windows laptop tasks OFF (see README)."
printf 'Primary? [y/N] '; read -r a
case "$a" in [yY]*) date > "$APP/PRIMARY_AGENT"; echo "this Mac is PRIMARY";; *) rm -f "$APP/PRIMARY_AGENT"; echo "this Mac is STANDBY (no pulls)";; esac

echo "== LaunchAgents =="
for n in pull watcher; do
  dst="$LA/com.crystal.$n.plist"
  launchctl bootout "gui/$UID_N/com.crystal.$n" 2>/dev/null || true
  sed -e "s#__BIN__#$BIN#g" -e "s#__LOGS__#$LOGS#g" "$SRC/com.crystal.$n.plist" > "$dst"
  plutil -lint "$dst" >/dev/null
  launchctl bootstrap "gui/$UID_N" "$dst"
  echo "loaded com.crystal.$n"
done

echo
echo "Wake for the 5:40 pulls needs admin rights once (lid must be open or on power):"
echo "  sudo pmset repeat wakeorpoweron MTWRFSU 05:35:00"
echo "  (pmset allows ONE repeating wake; for 17:35 too, keep the Mac awake on power at that time - see README)"
echo
/usr/bin/python3 "$BIN/crystal_sync.py" status
if [ "$TEST" = 1 ]; then
  echo "== Test: one ParentVUE login (macOS may ask to allow Keychain access: click Always Allow) =="
  /usr/bin/python3 "$BIN/crystal_sync.py" fetch || { echo "TEST FAILED - see $LOGS/sync.log"; exit 1; }
  echo "Test pull OK. Press Sync in Crystal to test the full upload (primary Mac only)."
fi
