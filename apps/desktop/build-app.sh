#!/bin/bash
# build-app.sh — Manually assemble PDF Max.app from the pre-extracted Electron.app
# This bypasses electron-builder/electron-packager which need iCloud-locked temp dirs.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ELECTRON_APP="$SCRIPT_DIR/node_modules/electron/Electron.app"
OUT_DIR="$SCRIPT_DIR/dist/mac-arm64"
APP_NAME="PDF Max"
APP_BUNDLE="$OUT_DIR/$APP_NAME.app"
WEB_OUT="$SCRIPT_DIR/../web/out"

echo "▶︎ Building $APP_NAME.app from pre-extracted Electron..."
echo "  Electron: $ELECTRON_APP"
echo "  Web out:  $WEB_OUT"
echo "  Output:   $APP_BUNDLE"

# 1. Create output directory and copy Electron.app
mkdir -p "$OUT_DIR"
rm -rf "$APP_BUNDLE"
cp -R "$ELECTRON_APP" "$APP_BUNDLE"
echo "  ✓ Copied Electron.app"

# 2. Rename the executable
mv "$APP_BUNDLE/Contents/MacOS/Electron" "$APP_BUNDLE/Contents/MacOS/PDF Max"
echo "  ✓ Renamed executable"

# 3. Write a proper Info.plist
cat > "$APP_BUNDLE/Contents/Info.plist" << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDisplayName</key>
  <string>PDF Max</string>
  <key>CFBundleExecutable</key>
  <string>PDF Max</string>
  <key>CFBundleIdentifier</key>
  <string>com.pdfmax.desktop</string>
  <key>CFBundleName</key>
  <string>PDF Max</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0.0</string>
  <key>CFBundleVersion</key>
  <string>1.0.0</string>
  <key>CFBundleIconFile</key>
  <string>electron.icns</string>
  <key>LSMinimumSystemVersion</key>
  <string>11.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSSupportsAutomaticGraphicsSwitching</key>
  <true/>
  <key>ElectronTeamID</key>
  <string></string>
  <key>NSRequiresAquaSystemAppearance</key>
  <false/>
</dict>
</plist>
PLIST
echo "  ✓ Wrote Info.plist"

# 4. Copy compiled Electron main process (dist-electron/)
mkdir -p "$APP_BUNDLE/Contents/Resources/app"
cp -R "$SCRIPT_DIR/dist-electron" "$APP_BUNDLE/Contents/Resources/app/"
echo "  ✓ Copied dist-electron/"

# 5. Copy package.json (Electron needs it to find main entry point)
cp "$SCRIPT_DIR/package.json" "$APP_BUNDLE/Contents/Resources/app/"
echo "  ✓ Copied package.json"

# 6. Copy node_modules needed at runtime (just the electron-runtime ones)
# The main process only needs built-in node modules + Electron — nothing extra.
# echo "  (skipping node_modules — main process uses only Node built-ins)"

# 7. Copy the Next.js static web app as extraResources
mkdir -p "$APP_BUNDLE/Contents/Resources/app-web"
cp -R "$WEB_OUT/." "$APP_BUNDLE/Contents/Resources/app-web/"
echo "  ✓ Copied web out/ → Resources/app-web/"

# 8. Update main.ts path: the packaged app reads web files from app-web/
# (already handled in main.ts via process.resourcesPath + /app-web/)

echo ""
echo "✅ $APP_NAME.app built at:"
echo "   $APP_BUNDLE"
echo ""
echo "Launch with:"
echo "   open '$APP_BUNDLE'"
