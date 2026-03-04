#!/usr/bin/env bash
# Chrome Web Store API Setup Guide
# This script walks you through setting up OAuth credentials for the Chrome Web Store API.
# Usage: bash scripts/cws-setup.sh
set -euo pipefail

BOLD='\033[1m'
DIM='\033[2m'
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

header() { echo -e "\n${BOLD}${CYAN}═══ $1 ═══${NC}\n"; }
step()   { echo -e "${BOLD}${GREEN}[$1]${NC} $2"; }
info()   { echo -e "    ${DIM}$1${NC}"; }
warn()   { echo -e "    ${YELLOW}⚠  $1${NC}"; }

header "Chrome Web Store API Setup"
echo "This guide helps you set up OAuth credentials to upload and publish"
echo "your extension to the Chrome Web Store via the API."
echo ""

# ─── Prerequisites ───

header "Step 1: Prerequisites"
step "1.1" "Chrome Web Store Developer Account"
info "Register at: https://chrome.google.com/webstore/devconsole"
info "One-time fee: \$5"
echo ""

step "1.2" "First-time upload (manual)"
info "You must create the extension listing ONCE manually in the Developer Dashboard:"
info "  1. Go to https://chrome.google.com/webstore/devconsole"
info "  2. Click 'New Item'"
info "  3. Upload a zip of your extension (from: frontend/dist-extension/)"
info "  4. Fill in the required listing details (name, description, screenshots, privacy policy)"
info "  5. Set visibility to 'Private' or 'Unlisted' for now"
info "  6. Save as draft (do NOT publish yet)"
info ""
info "After creation, note the Extension ID from the URL or dashboard."
info "It looks like: abcdefghijklmnopqrstuvwxyzabcdef"
echo ""

# ─── Google Cloud Console Setup ───

header "Step 2: Google Cloud Console"
step "2.1" "Enable the Chrome Web Store API"
info "1. Go to: https://console.cloud.google.com/apis/library"
info "2. Search for 'Chrome Web Store API'"
info "3. Click 'Enable'"
echo ""

step "2.2" "Configure OAuth Consent Screen"
info "1. Go to: https://console.cloud.google.com/apis/credentials/consent"
info "2. Select 'External' user type"
info "3. Fill in app name (e.g., 'Procura CWS Publisher') and your email"
info "4. Add scope: https://www.googleapis.com/auth/chromewebstore"
info "5. Add your email as a test user"
info "6. Save"
echo ""

step "2.3" "Create OAuth Client ID"
info "1. Go to: https://console.cloud.google.com/apis/credentials"
info "2. Click 'Create Credentials' → 'OAuth Client ID'"
info "3. Application type: 'Desktop app' (or 'Web application')"
info "   If Web application: add redirect URI: http://localhost:8818"
info "4. Note the Client ID and Client Secret"
echo ""

# ─── Get Refresh Token ───

header "Step 3: Obtain Refresh Token"
echo "Enter your OAuth credentials to generate a refresh token."
echo ""

read -rp "Client ID: " CLIENT_ID
read -rp "Client Secret: " CLIENT_SECRET

if [ -z "$CLIENT_ID" ] || [ -z "$CLIENT_SECRET" ]; then
    echo -e "${RED}Error: Client ID and Client Secret are required.${NC}"
    exit 1
fi

# Build the authorization URL
AUTH_URL="https://accounts.google.com/o/oauth2/auth?response_type=code&client_id=${CLIENT_ID}&redirect_uri=http://localhost:8818&scope=https://www.googleapis.com/auth/chromewebstore&access_type=offline&prompt=consent"

echo ""
step "3.1" "Open this URL in your browser:"
echo ""
echo -e "    ${CYAN}${AUTH_URL}${NC}"
echo ""
info "After granting access, you will be redirected to a localhost URL."
info "The page won't load — that's expected. Copy the 'code' parameter from the URL."
info "Example: http://localhost:8818/?code=4/0XXXXX..."
echo ""

read -rp "Authorization code: " AUTH_CODE

if [ -z "$AUTH_CODE" ]; then
    echo -e "${RED}Error: Authorization code is required.${NC}"
    exit 1
fi

echo ""
step "3.2" "Exchanging code for refresh token..."

RESPONSE=$(curl -s -X POST "https://oauth2.googleapis.com/token" \
    -d "client_id=${CLIENT_ID}" \
    -d "client_secret=${CLIENT_SECRET}" \
    -d "code=${AUTH_CODE}" \
    -d "grant_type=authorization_code" \
    -d "redirect_uri=http://localhost:8818")

REFRESH_TOKEN=$(echo "$RESPONSE" | node -e "
    let d='';
    process.stdin.on('data',c=>d+=c);
    process.stdin.on('end',()=>{
        try {
            const r=JSON.parse(d);
            if(r.refresh_token) console.log(r.refresh_token);
            else { console.error('Error:', JSON.stringify(r)); process.exit(1); }
        } catch(e) { console.error('Failed to parse response'); process.exit(1); }
    });
" 2>&1)

if [ $? -ne 0 ]; then
    echo -e "${RED}Failed to obtain refresh token:${NC}"
    echo "$REFRESH_TOKEN"
    echo ""
    echo "Full response:"
    echo "$RESPONSE"
    exit 1
fi

# ─── Output ───

header "Step 4: Save Credentials"

echo "Add these to your ${BOLD}scripts/.env${NC} file:"
echo ""
echo -e "${GREEN}# Chrome Web Store API${NC}"
echo "CWS_EXTENSION_ID=your-extension-id-from-dashboard"
echo "CWS_CLIENT_ID=${CLIENT_ID}"
echo "CWS_CLIENT_SECRET=${CLIENT_SECRET}"
echo "CWS_REFRESH_TOKEN=${REFRESH_TOKEN}"
echo ""
warn "Replace 'your-extension-id-from-dashboard' with your actual Extension ID"
warn "from the Chrome Web Store Developer Dashboard."

# ─── Permission Justification Template ───

header "Step 5: Permission Justification (for CWS submission)"

echo "When submitting, you'll be asked to justify your permissions."
echo "Copy-paste this into the submission form:"
echo ""
echo -e "${DIM}────────────────────────────────────────${NC}"
cat << 'JUSTIFICATION'
Procura is an AI browser assistant that provides tools to interact with
any web page the user is viewing. The <all_urls> host permission and
content scripts are required because:

1. "Read Active Tab" tool: Extracts text content from the currently
   active page so the AI can answer questions about it.

2. "Screenshot" tool: Captures a screenshot of the current page for
   visual analysis by the AI.

3. "Click / Type" tools: Allows the AI to interact with page elements
   (buttons, forms) on behalf of the user.

4. "Deep Link" content script: Handles procura:// protocol links on
   any page to open the extension with pre-filled context.

All browser interactions are ONLY triggered by explicit user action
within the extension's side panel. No scripts run automatically, no
data is collected in the background, and no browsing activity is
monitored or transmitted.
JUSTIFICATION
echo -e "${DIM}────────────────────────────────────────${NC}"

echo ""
echo -e "${GREEN}${BOLD}✅ Setup complete!${NC}"
echo ""
echo "Next steps:"
echo "  1. Complete the Extension listing in the Developer Dashboard"
echo "  2. Add your Extension ID to scripts/.env"
echo "  3. Run: bash scripts/cws-publish.sh"
