#!/bin/sh
# Stop Agent HQ and remove the login item and the "Agent HQ" app. Tickets in data/ are kept.
set -eu

LABEL=com.agent-hq.server
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
rm -rf "$HOME/Applications/Agent HQ.app"
echo "Agent HQ no longer starts at login."
