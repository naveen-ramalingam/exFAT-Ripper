#!/usr/bin/env bash
# ============================================================
#  Build exFAT Ripper into a native macOS .app bundle
# ============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo ""
echo "============================================"
echo "    exFAT Ripper - macOS .app Builder"
echo "============================================"
echo ""

# 1. Locate Python 3.10+
if [ -f "$SCRIPT_DIR/.venv/bin/python" ]; then
    PY="$SCRIPT_DIR/.venv/bin/python"
elif command -v python3.12 &>/dev/null; then
    PY="python3.12"
elif command -v python3.11 &>/dev/null; then
    PY="python3.11"
elif command -v python3.10 &>/dev/null; then
    PY="python3.10"
elif command -v python3 &>/dev/null; then
    PY="python3"
else
    echo "[X] Python was not found. Install with: brew install python@3.12"
    exit 1
fi

PY_VER=$("$PY" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
PY_MAJOR=$("$PY" -c "import sys; print(sys.version_info.major)")
PY_MINOR=$("$PY" -c "import sys; print(sys.version_info.minor)")

if [ "$PY_MAJOR" -lt 3 ] || ([ "$PY_MAJOR" -eq 3 ] && [ "$PY_MINOR" -lt 10 ]); then
    echo "[X] Python $PY_VER found, but Python 3.10+ is required."
    echo "    Install Python 3.12 with Homebrew: brew install python@3.12"
    exit 1
fi

echo "[1/4] Using Python $PY_VER ($PY)"

# 2. Generate app.icns if not present
if [ ! -f "app.icns" ] && [ -f "app.png" ]; then
    echo "[2/4] Generating macOS app.icns icon from app.png..."
    mkdir -p icon.iconset
    sips -s format png -z 16 16     app.png --out icon.iconset/icon_16x16.png &>/dev/null
    sips -s format png -z 32 32     app.png --out icon.iconset/icon_16x16@2x.png &>/dev/null
    sips -s format png -z 32 32     app.png --out icon.iconset/icon_32x32.png &>/dev/null
    sips -s format png -z 64 64     app.png --out icon.iconset/icon_32x32@2x.png &>/dev/null
    sips -s format png -z 128 128   app.png --out icon.iconset/icon_128x128.png &>/dev/null
    sips -s format png -z 256 256   app.png --out icon.iconset/icon_128x128@2x.png &>/dev/null
    sips -s format png -z 256 256   app.png --out icon.iconset/icon_256x256.png &>/dev/null
    sips -s format png -z 512 512   app.png --out icon.iconset/icon_256x256@2x.png &>/dev/null
    sips -s format png -z 512 512   app.png --out icon.iconset/icon_512x512.png &>/dev/null
    sips -s format png -z 1024 1024 app.png --out icon.iconset/icon_512x512@2x.png &>/dev/null
    iconutil -c icns icon.iconset -o app.icns
    rm -rf icon.iconset
else
    echo "[2/4] Icon ready."
fi

# 3. Ensure dependencies & Playwright Chromium installed
echo "[3/4] Ensuring dependencies and Chromium are ready..."
"$PY" -m pip install -q -r requirements.txt
"$PY" -m playwright install chromium

# 4. Build with PyInstaller
echo "[4/4] Building macOS .app bundle..."
"$PY" -m PyInstaller exFAT_Ripper.spec --noconfirm

echo ""
echo "============================================"
echo " Build Succeeded!"
echo " App Bundle: dist/exFAT Ripper.app"
echo "============================================"
echo ""
echo "To run the app:"
echo "  open \"dist/exFAT Ripper.app\""
echo ""
echo "To install for system-wide use:"
echo "  cp -R \"dist/exFAT Ripper.app\" /Applications/"
echo ""
