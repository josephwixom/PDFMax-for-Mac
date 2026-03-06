#!/bin/bash
# build-app.sh — Assemble PDF Max.app from the pre-extracted Electron binary.
# Works locally (iCloud Desktop) and on GitHub Actions CI (npm workspace hoisting).

set -ex  # -e = exit on error, -x = print each command (visible in CI logs)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "=== build-app.sh ==="
echo "SCRIPT_DIR: $SCRIPT_DIR"
echo "REPO_ROOT:  $REPO_ROOT"

# ── Locate Electron.app ──────────────────────────────────────────────────────
# electron is a workspace devDep of apps/desktop so npm may hoist it to
# root node_modules. Find it via the node 'electron' package's path.txt file.
ELECTRON_PKG=$(node -e "
  try {
    // resolve the electron package.json from the script dir context
    const p = require.resolve('electron/package.json', { paths: ['$SCRIPT_DIR', '$REPO_ROOT'] });
    process.stdout.write(require('path').dirname(p));
  } catch(e) {
    process.stderr.write('ERROR: ' + e.message + '\n');
    process.exit(1);
  }
")
echo "Electron pkg dir: $ELECTRON_PKG"

# Read path.txt to get the relative path to the binary inside Electron.app
ELECTRON_PATH_TXT="$ELECTRON_PKG/path.txt"
if [ ! -f "$ELECTRON_PATH_TXT" ]; then
  echo "ERROR: $ELECTRON_PATH_TXT not found — Electron binary not installed"
  exit 1
fi

ELECTRON_REL=$(cat "$ELECTRON_PATH_TXT")
ELECTRON_BIN="$ELECTRON_PKG/$ELECTRON_REL"
echo "Electron binary: $ELECTRON_BIN"

# Walk up from the binary to find the .app bundle
# Binary is at: Electron.app/Contents/MacOS/Electron
ELECTRON_APP="$(cd "$(dirname "$ELECTRON_BIN")/../../.." && pwd)"
echo "Electron.app:    $ELECTRON_APP"

if [ ! -d "$ELECTRON_APP" ]; then
  echo "ERROR: Electron.app not found at $ELECTRON_APP"
  ls "$ELECTRON_PKG/"
  exit 1
fi

# ── Variables ────────────────────────────────────────────────────────────────
OUT_DIR="$SCRIPT_DIR/dist/mac-arm64"
APP_NAME="PDF Max"
APP_BUNDLE="$OUT_DIR/$APP_NAME.app"
WEB_OUT="$REPO_ROOT/apps/web/out"

echo "Web out: $WEB_OUT"
echo "Output:  $APP_BUNDLE"

if [ ! -d "$WEB_OUT" ]; then
  echo "ERROR: Web out directory not found: $WEB_OUT"
  exit 1
fi

# ── 1. Copy Electron.app ────────────────────────────────────────────────────
mkdir -p "$OUT_DIR"
rm -rf "$APP_BUNDLE"
cp -R "$ELECTRON_APP" "$APP_BUNDLE"
echo "✓ Copied Electron.app"

# ── 2. Rename executable ─────────────────────────────────────────────────────
mv "$APP_BUNDLE/Contents/MacOS/Electron" "$APP_BUNDLE/Contents/MacOS/PDF Max"
echo "✓ Renamed executable"

# ── 3. Write Info.plist ──────────────────────────────────────────────────────
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
  <key>NSRequiresAquaSystemAppearance</key>
  <false/>
</dict>
</plist>
PLIST
echo "✓ Wrote Info.plist"

# ── 4. Copy compiled Electron main process ───────────────────────────────────
mkdir -p "$APP_BUNDLE/Contents/Resources/app"
cp -R "$SCRIPT_DIR/dist-electron" "$APP_BUNDLE/Contents/Resources/app/"
cp "$SCRIPT_DIR/package.json"     "$APP_BUNDLE/Contents/Resources/app/"
echo "✓ Copied Electron main process (dist-electron/ + package.json)"

# ── 5. Copy the Next.js static web app ──────────────────────────────────────
mkdir -p "$APP_BUNDLE/Contents/Resources/app-web"
cp -R "$WEB_OUT/." "$APP_BUNDLE/Contents/Resources/app-web/"
echo "✓ Copied web out/ → Resources/app-web/"

echo ""
echo "✅ PDF Max.app built at: $APP_BUNDLE"
