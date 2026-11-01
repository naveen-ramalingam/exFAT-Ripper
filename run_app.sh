#!/usr/bin/env bash
# ============================================================
#  Run exFAT Ripper on macOS
# ============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 1. Use virtual environment if present
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
    echo "[X] Python was not found."
    echo "    Please install Python 3.10+ using Homebrew: brew install python@3.12"
    exit 1
fi

# Verify Python version >= 3.10
PY_VER=$($PY -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
PY_MAJOR=$($PY -c "import sys; print(sys.version_info.major)")
PY_MINOR=$($PY -c "import sys; print(sys.version_info.minor)")

if [ "$PY_MAJOR" -lt 3 ] || ([ "$PY_MAJOR" -eq 3 ] && [ "$PY_MINOR" -lt 10 ]); then
    echo "[X] Python $PY_VER found, but Python 3.10+ is required."
    echo "    Install Python 3.12 with Homebrew: brew install python@3.12"
    exit 1
fi

echo "Starting exFAT Ripper with $PY (Python $PY_VER)..."
exec "$PY" app.py
