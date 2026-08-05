#!/bin/sh
# Rebuild Vesta and put it back on the connected iPhone.
#
# Free personal-team signatures last seven days. On day eight the app refuses to
# launch and every Wallet automation fails with "couldn't communicate with a
# helper application" — so this needs running weekly, and the app warns two days
# ahead. Plug the phone in, unlock it, run this.
set -e
cd "$(dirname "$0")"

# The hardware UDID, not the CoreDevice identifier devicectl prints in its
# table — xcodebuild's -destination only understands the former.
xcrun devicectl list devices --json-output "$TMPDIR/vesta-devices.json" >/dev/null 2>&1
DEVICE=$(python3 - "$TMPDIR/vesta-devices.json" <<'PY'
import json, sys
devices = json.load(open(sys.argv[1]))["result"]["devices"]
for d in devices:
    if d["connectionProperties"].get("tunnelState") != "unavailable":
        print(d["hardwareProperties"]["udid"])
        break
PY
)
if [ -z "$DEVICE" ]; then
  echo "No connected device. Plug the iPhone in, unlock it, and trust this Mac."
  exit 1
fi

echo "Building…"
xcodebuild \
  -project VestaQuickAdd.xcodeproj \
  -scheme VestaQuickAdd \
  -configuration Debug \
  -destination "id=$DEVICE" \
  -derivedDataPath build/dd \
  -allowProvisioningUpdates \
  build | tail -5

APP=build/dd/Build/Products/Debug-iphoneos/VestaQuickAdd.app
echo "Installing…"
xcrun devicectl device install app --device "$DEVICE" "$APP"

EXPIRY=$(security cms -D -i "$APP/embedded.mobileprovision" 2>/dev/null \
  | plutil -extract ExpirationDate raw -o - - 2>/dev/null)
echo
echo "Installed. Signature good until: $EXPIRY"
echo "Open the app once so iOS registers the intent, then test a card tap."
