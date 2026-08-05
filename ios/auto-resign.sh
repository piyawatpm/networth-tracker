#!/bin/zsh
# Keep the free 7-day signature alive without thinking about it.
#
# Runs from launchd (see install-auto-resign.sh) every evening. Does nothing
# while the current signature has >4 days left; past that it deletes this
# app's cached provisioning profiles — which is what forces Xcode to mint a
# fresh 7-day one instead of reusing the old deadline — rebuilds, and pushes
# to the phone. Success or failure lands as a Mac notification, and the app
# itself still warns 2 days out as the final backstop.
#
# What it can't automate (Apple's rules, not ours):
#   * The phone must be reachable — cable, or same Wi-Fi as this Mac.
#   * Every few weeks Apple may invalidate the Xcode session and demand an
#     interactive 2FA login. The failure notification names that fix.
set -u
cd "$(dirname "$0")"

LOG=~/Library/Logs/vesta-resign.log
exec >>"$LOG" 2>&1
echo "── $(date '+%F %T') auto-resign run"

notify() { # title, body
  /usr/bin/osascript -e "display notification \"$2\" with title \"$1\"" 2>/dev/null
}

APP=build/dd/Build/Products/Release-iphoneos/VestaQuickAdd.app
PROFILE="$APP/embedded.mobileprovision"

days_left() {
  local expiry epoch now
  expiry=$(security cms -D -i "$PROFILE" 2>/dev/null \
    | plutil -extract ExpirationDate raw -o - - 2>/dev/null) || return 1
  epoch=$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$expiry" +%s 2>/dev/null) || return 1
  now=$(date +%s)
  echo $(( (epoch - now) / 86400 ))
}

LEFT=$(days_left || echo 0)
echo "signature days left: $LEFT"
if [ "${1:-}" != "--force" ] && [ "$LEFT" -gt 4 ]; then
  echo "fresh enough — nothing to do"
  exit 0
fi

# Force a NEW 7-day profile: Xcode reuses a cached one (keeping its old
# expiry) unless it's gone. Only this app's profiles are touched.
PROFILES_DIR=~/Library/Developer/Xcode/UserData/Provisioning\ Profiles
for p in "$PROFILES_DIR"/*.mobileprovision(N); do
  name=$(security cms -D -i "$p" 2>/dev/null | plutil -extract Name raw -o - - 2>/dev/null)
  case "$name" in
    *com.piyawatpm.vesta*) echo "dropping cached profile: $name"; rm -f "$p" ;;
  esac
done

if ./reinstall.sh; then
  NEW=$(days_left || echo "?")
  echo "re-signed OK — $NEW days on the new signature"
  notify "Vesta re-signed" "Fresh signature pushed to the iPhone — good for $NEW days."
else
  echo "re-sign FAILED"
  if [ "$LEFT" -le 2 ]; then
    # Urgent: the in-app deadline is close and automation can't save it.
    notify "Vesta re-sign FAILED — $LEFT days left" \
      "Plug the iPhone in and run ios/reinstall.sh. If the build complains about signing, open Xcode and sign in again."
  else
    # Quiet failure — likely the phone just wasn't reachable tonight.
    # Tomorrow's run retries; only nag when it starts to matter.
    echo "phone likely unreachable; will retry tomorrow ($LEFT days of margin)"
  fi
  exit 1
fi
