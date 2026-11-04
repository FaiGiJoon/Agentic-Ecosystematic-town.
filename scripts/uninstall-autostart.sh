#!/bin/sh
# Stop Koala Grove and remove the login item and the "Koala Grove" app (and the older Agent HQ ones).
# The koalas' memories in data/ are kept.
set -eu

for LABEL in com.koala-grove.server com.agent-hq.server; do
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
done
rm -rf "$HOME/Applications/Koala Grove.app" "$HOME/Applications/Agent HQ.app"
echo "Koala Grove no longer starts at login."
