#!/usr/bin/env bash
# Render Chrome Web Store screenshot slides from Marp to PNG
# Marp outputs 1280x720 (16:9), this script extends to 1280x800 (CWS requirement)
# by adding 40px padding top and bottom with matching background color.
#
# Usage: bash scripts/cws-screenshots.sh
# Requires: marp (npm i -g @marp-team/marp-cli), imagemagick (convert, identify)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SLIDES_DIR="$ROOT/document/chromewebstore"
SLIDES_FILE="$SLIDES_DIR/slides.md"
BG_COLOR="#f0f1f6"

if [ ! -f "$SLIDES_FILE" ]; then
    echo "Error: $SLIDES_FILE not found."
    exit 1
fi

# Check dependencies
for cmd in marp convert identify; do
    if ! command -v "$cmd" &>/dev/null; then
        echo "Error: '$cmd' is required but not installed."
        exit 1
    fi
done

echo "Rendering Marp slides..."
(cd "$SLIDES_DIR" && marp slides.md --images png --allow-local-files)

echo ""
echo "Extending to 1280x800 (adding 40px top + 40px bottom)..."
for f in "$SLIDES_DIR"/slides.*.png; do
    # Add 40px bottom (anchor image to north/top, extend canvas down)
    convert "$f" \
        -gravity north \
        -background "$BG_COLOR" \
        -extent 1280x760 \
        "$f"
    # Add 40px top (anchor image to south/bottom, extend canvas up)
    convert "$f" \
        -gravity south \
        -background "$BG_COLOR" \
        -extent 1280x800 \
        "$f"
    SIZE=$(identify -format "%wx%h" "$f")
    echo "  $(basename "$f"): $SIZE"
done

echo ""
echo "✅ Screenshots ready in $SLIDES_DIR/"
echo "   Upload slides.001.png – slides.003.png to Chrome Web Store."
