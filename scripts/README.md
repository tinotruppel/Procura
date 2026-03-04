# Scripts

Helper scripts for debugging and testing Procura.

## Setup

```bash
cp .env.example .env
# Fill in your values
```

## Scripts

### `decrypt-sync.mjs`

Decrypt raw sync data fetched from the Procura sync API.

```bash
node decrypt-sync.mjs [encrypted-data-file]
```

Requires `PROCURA_URL`, `PROCURA_SECURITY_KEY`, and `PROCURA_API_KEY` in `.env`.

### `decrypt-vault-export.mjs`

Decrypt an exported Procura config file to verify vault key compatibility.

```bash
node decrypt-vault-export.mjs <config.json>
```

Requires `PROCURA_SECURITY_KEY` in `.env`.

### `release.sh`

Bump version in all `package.json` files, commit, create a git tag, and publish a GitHub Release.

```bash
bash release.sh 0.2.0
bash release.sh 0.2.0 --cws  # also publish to Chrome Web Store
```

Validates semver format, checks for a clean working tree, and prevents duplicate tags.

### `cws-setup.sh`

Interactive guide to set up Chrome Web Store API credentials (OAuth Client ID, Secret, Refresh Token).

```bash
bash cws-setup.sh
```

Walks you through enabling the Chrome Web Store API in Google Cloud Console, creating OAuth credentials, and obtaining a refresh token. Also provides a permission justification template for the CWS submission form.

### `cws-publish.sh`

Upload and publish the extension to the Chrome Web Store.

```bash
bash cws-publish.sh              # Build, upload & publish to trusted testers
bash cws-publish.sh --public     # Publish to everyone
bash cws-publish.sh --skip-build # Use existing dist-extension/
bash cws-publish.sh --dry-run    # Validate without uploading
```

Requires `CWS_EXTENSION_ID`, `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, and `CWS_REFRESH_TOKEN` in `.env`.

### `test-all.sh`

Run the full test and quality workflow (tests, coverage, ESLint, Semgrep, npm audit, build).

```bash
bash test-all.sh
```

Logs are written to `/tmp/frontend-*.log` and `/tmp/backend-*.log`.
