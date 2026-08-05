#!/bin/zsh
# One-time setup: schedule auto-resign.sh every evening at 8pm via launchd.
# Run again any time — it replaces the existing schedule. Remove with:
#   launchctl bootout gui/$(id -u)/com.piyawatpm.vesta.resign
set -eu
cd "$(dirname "$0")"

LABEL=com.piyawatpm.vesta.resign
PLIST=~/Library/LaunchAgents/$LABEL.plist
SCRIPT=$PWD/auto-resign.sh

mkdir -p ~/Library/LaunchAgents
cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/zsh</string>
        <string>-lc</string>
        <string>"$SCRIPT"</string>
    </array>
    <!-- 11:00 with a 14:00 retry — the Mac is a work machine, so late
         morning is when it's reliably awake with the phone nearby. The
         retry covers "away from the desk at 11"; the script exits in a
         second when 11:00 already renewed. launchd runs a missed slot on
         next wake, so a closed lid delays the check rather than skipping
         the day. -->
    <key>StartCalendarInterval</key>
    <array>
        <dict><key>Hour</key><integer>11</integer><key>Minute</key><integer>0</integer></dict>
        <dict><key>Hour</key><integer>14</integer><key>Minute</key><integer>0</integer></dict>
    </array>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Scheduled: $LABEL daily at 11:00 (retry 14:00)"
echo "Log: ~/Library/Logs/vesta-resign.log"
