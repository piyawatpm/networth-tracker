#!/bin/zsh
# One-time setup: schedule auto-resign.sh daily at 11:00 (14:00 retry) via
# launchd. Run again any time — it replaces the existing schedule. Remove with:
#   launchctl bootout gui/$(id -u)/com.piyawatpm.vesta.resign
#
# The job runs from a MIRROR of ios/ at ~/.vesta-resign, not from this repo.
# The repo lives under ~/Desktop, which macOS privacy protection (TCC) hides
# from launchd jobs — every scheduled run died with exit 127 before it could
# even open the script, while manual runs from a terminal (which has Desktop
# access) worked, which is exactly why the breakage went unnoticed. Home
# dotfolders carry no such protection. reinstall.sh refreshes the mirror after
# every successful install, so the agent always re-signs what's on the phone.
set -eu
cd "$(dirname "$0")"

LABEL=com.piyawatpm.vesta.resign
PLIST=~/Library/LaunchAgents/$LABEL.plist
MIRROR=$HOME/.vesta-resign

mkdir -p "$MIRROR"
rsync -a --delete --exclude build --exclude '*.log' ./ "$MIRROR/ios/"

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
        <string>$MIRROR/ios/auto-resign.sh</string>
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

# The Desktop keeps a symlink to the log so it stays one double-click away —
# only the writer moved out of TCC's reach.
if [ ! -L ~/Desktop/vesta-resign.log ]; then
  if [ -f ~/Desktop/vesta-resign.log ]; then
    cat ~/Desktop/vesta-resign.log >>"$MIRROR/resign.log"
    rm ~/Desktop/vesta-resign.log
  fi
  ln -s "$MIRROR/resign.log" ~/Desktop/vesta-resign.log
fi

echo "Scheduled: $LABEL daily at 11:00 (retry 14:00), running from $MIRROR/ios"
echo "Log: $MIRROR/resign.log (symlinked on the Desktop)"
