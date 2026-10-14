#!/bin/sh
# uninstall.sh - stop and remove the Crystal sync from this Mac.  --keep-secrets leaves the Keychain items.
set -u
APP="$HOME/Library/Application Support/Crystal"
UID_N=$(id -u)
for n in pull watcher; do
  launchctl bootout "gui/$UID_N/com.crystal.$n" 2>/dev/null || true
  rm -f "$HOME/Library/LaunchAgents/com.crystal.$n.plist"
done
rm -rf "$APP"
if [ "${1:-}" != "--keep-secrets" ]; then
  security delete-generic-password -s crystal-parentvue >/dev/null 2>&1 || true
  security delete-generic-password -s crystal-agent-secret >/dev/null 2>&1 || true
  echo "Keychain items removed."
fi
echo "Removed. Logs kept in ~/Library/Logs/Crystal (delete by hand if you like)."
echo "If you set a wake schedule:  sudo pmset repeat cancel"
echo "Remember to turn the Windows laptop tasks back ON if it should take over (README 'Primary agent')."
