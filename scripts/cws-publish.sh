#!/usr/bin/env bash
# Chrome Web Store Publish Script
# Builds, uploads, and publishes the Procura extension to the Chrome Web Store.
#
# Usage:
#   bash scripts/cws-publish.sh              # Upload & publish to trusted testers
#   bash scripts/cws-publish.sh --public     # Upload & publish to everyone
#   bash scripts/cws-publish.sh --skip-build # Skip build step, use existing dist
#   bash scripts/cws-publish.sh --dry-run    # Validate without uploading
#
# Prerequisites:
#   - scripts/.env with CWS_EXTENSION_ID, CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN
#   - Run scripts/cws-setup.sh first to obtain credentials
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/scripts/.env"
DIST_DIR="$ROOT/frontend/dist-extension"

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
DIM='\033[2m'
NC='\033[0m'

# ─── Parse flags ───

PUBLISH_TARGET="trustedTesters"
SKIP_BUILD=false
DRY_RUN=false

for arg in "$@"; do
    case "$arg" in
        --public)     PUBLISH_TARGET="default" ;;
        --skip-build) SKIP_BUILD=true ;;
        --dry-run)    DRY_RUN=true ;;
        --help|-h)
            echo "Usage: bash scripts/cws-publish.sh [--public] [--skip-build] [--dry-run]"
            echo ""
            echo "Flags:"
            echo "  --public      Publish to all users (default: trustedTesters)"
            echo "  --skip-build  Skip the build step, use existing dist-extension/"
            echo "  --dry-run     Validate everything without uploading"
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown flag: $arg${NC}"
            echo "Run with --help for usage."
            exit 1
            ;;
    esac
done

# ─── Load credentials ───

if [ ! -f "$ENV_FILE" ]; then
    echo -e "${RED}Error: $ENV_FILE not found.${NC}"
    echo "Run 'bash scripts/cws-setup.sh' first to set up credentials."
    exit 1
fi

# Source only CWS_ variables from .env
while IFS= read -r line; do
    eval "export $line"
done < <(grep '^CWS_[A-Z_]*=' "$ENV_FILE" | sed 's/[[:space:]]*=[[:space:]]*/=/')

MISSING=""
[ -z "${CWS_EXTENSION_ID:-}" ] && MISSING="$MISSING CWS_EXTENSION_ID"
[ -z "${CWS_CLIENT_ID:-}" ]    && MISSING="$MISSING CWS_CLIENT_ID"
[ -z "${CWS_CLIENT_SECRET:-}" ] && MISSING="$MISSING CWS_CLIENT_SECRET"
[ -z "${CWS_REFRESH_TOKEN:-}" ] && MISSING="$MISSING CWS_REFRESH_TOKEN"

if [ -n "$MISSING" ]; then
    echo -e "${RED}Error: Missing environment variables in $ENV_FILE:${NC}"
    echo "  $MISSING"
    echo ""
    echo "Run 'bash scripts/cws-setup.sh' to set up credentials."
    exit 1
fi

# ─── Build ───

if [ "$SKIP_BUILD" = false ]; then
    echo -e "${BOLD}Building extension...${NC}"
    (cd "$ROOT/frontend" && npm run build:extension)
    echo ""
fi

# ─── Verify dist ───

if [ ! -d "$DIST_DIR" ]; then
    echo -e "${RED}Error: $DIST_DIR not found. Run 'npm run build:extension' in frontend/ first.${NC}"
    exit 1
fi

if [ ! -f "$DIST_DIR/manifest.json" ]; then
    echo -e "${RED}Error: manifest.json not found in $DIST_DIR.${NC}"
    exit 1
fi

# ─── Create zip ───

VERSION=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$DIST_DIR/manifest.json','utf8')).version)")
ZIP_NAME="procura-v${VERSION}.zip"
ZIP_PATH="$ROOT/$ZIP_NAME"

echo -e "${BOLD}Creating $ZIP_NAME...${NC}"

# Remove files that shouldn't be in the CWS submission
rm -f "$DIST_DIR/manifest.webmanifest"

(cd "$DIST_DIR" && zip -r "$ZIP_PATH" . -x "*.map" "*.DS_Store")

ZIP_SIZE=$(du -h "$ZIP_PATH" | cut -f1)
echo -e "  ${DIM}Size: $ZIP_SIZE${NC}"
echo ""

# ─── Dry run check ───

if [ "$DRY_RUN" = true ]; then
    echo -e "${YELLOW}${BOLD}DRY RUN — skipping upload and publish.${NC}"
    echo ""
    echo "Would upload: $ZIP_PATH"
    echo "Extension ID: $CWS_EXTENSION_ID"
    echo "Publish target: $PUBLISH_TARGET"
    echo ""

    # Verify zip contents
    echo -e "${BOLD}Zip contents:${NC}"
    unzip -l "$ZIP_PATH" | tail -n +4 | head -n -2
    echo ""

    # Clean up
    rm -f "$ZIP_PATH"

    echo -e "${GREEN}${BOLD}✅ Dry run complete. Everything looks good.${NC}"
    exit 0
fi

# ─── Get access token ───

echo -e "${BOLD}Obtaining access token...${NC}"

ACCESS_TOKEN=$(curl -s -X POST "https://oauth2.googleapis.com/token" \
    -d "client_id=${CWS_CLIENT_ID}" \
    -d "client_secret=${CWS_CLIENT_SECRET}" \
    -d "refresh_token=${CWS_REFRESH_TOKEN}" \
    -d "grant_type=refresh_token" \
    | node -e "
        let d='';
        process.stdin.on('data',c=>d+=c);
        process.stdin.on('end',()=>{
            const r=JSON.parse(d);
            if(r.access_token) console.log(r.access_token);
            else { console.error(JSON.stringify(r)); process.exit(1); }
        });
    " 2>&1)

if [ $? -ne 0 ]; then
    echo -e "${RED}Failed to obtain access token:${NC}"
    echo "$ACCESS_TOKEN"
    rm -f "$ZIP_PATH"
    exit 1
fi

echo -e "  ${DIM}Token obtained.${NC}"
echo ""

# ─── Upload ───

echo -e "${BOLD}Uploading to Chrome Web Store...${NC}"

UPLOAD_RESPONSE=$(curl -s -X PUT \
    "https://www.googleapis.com/upload/chromewebstore/v1.1/items/${CWS_EXTENSION_ID}" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -H "x-goog-api-version: 2" \
    -T "$ZIP_PATH")

UPLOAD_STATUS=$(echo "$UPLOAD_RESPONSE" | node -e "
    let d='';
    process.stdin.on('data',c=>d+=c);
    process.stdin.on('end',()=>{
        const r=JSON.parse(d);
        console.log(r.uploadState || 'UNKNOWN');
        if(r.uploadState !== 'SUCCESS' && r.itemError) {
            r.itemError.forEach(e => console.error('  Error:', e.error_detail));
        }
    });
" 2>&1)

UPLOAD_STATE=$(echo "$UPLOAD_STATUS" | head -1)

if [ "$UPLOAD_STATE" != "SUCCESS" ]; then
    echo -e "${RED}Upload failed:${NC}"
    echo "$UPLOAD_STATUS"
    echo ""
    echo "Full response:"
    echo "$UPLOAD_RESPONSE"
    rm -f "$ZIP_PATH"
    exit 1
fi

echo -e "  ${GREEN}Upload successful.${NC}"
echo ""

# ─── Publish ───

echo -e "${BOLD}Publishing to ${PUBLISH_TARGET}...${NC}"

PUBLISH_RESPONSE=$(curl -s -X POST \
    "https://www.googleapis.com/chromewebstore/v1.1/items/${CWS_EXTENSION_ID}/publish" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -H "x-goog-api-version: 2" \
    -H "Content-Type: application/json" \
    -d "{\"target\":\"${PUBLISH_TARGET}\"}")

PUBLISH_STATUS=$(echo "$PUBLISH_RESPONSE" | node -e "
    let d='';
    process.stdin.on('data',c=>d+=c);
    process.stdin.on('end',()=>{
        const r=JSON.parse(d);
        if(r.status && r.status.includes('OK')) console.log('OK');
        else console.log(JSON.stringify(r));
    });
" 2>&1)

if [ "$PUBLISH_STATUS" != "OK" ]; then
    echo -e "${YELLOW}Publish response (may need review):${NC}"
    echo "$PUBLISH_STATUS"
else
    echo -e "  ${GREEN}Published successfully.${NC}"
fi

# ─── Cleanup ───

rm -f "$ZIP_PATH"

echo ""
echo -e "${GREEN}${BOLD}✅ Done!${NC}"
echo ""
echo "Extension: https://chrome.google.com/webstore/detail/${CWS_EXTENSION_ID}"
if [ "$PUBLISH_TARGET" = "trustedTesters" ]; then
    echo ""
    echo -e "${DIM}Published to Trusted Testers only.${NC}"
    echo -e "${DIM}Add testers in: https://chrome.google.com/webstore/devconsole${NC}"
fi
