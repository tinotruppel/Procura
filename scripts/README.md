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

Bump version in all `package.json` files, commit, and create a git tag.

```bash
bash release.sh 0.2.0
# or from root: npm run release -- 0.2.0
```

Validates semver format, checks for a clean working tree, and prevents duplicate tags.

### `test-all.sh`

Run the full test and quality workflow (tests, coverage, ESLint, Semgrep, npm audit, build).

```bash
bash test-all.sh
```

Logs are written to `/tmp/frontend-*.log` and `/tmp/backend-*.log`.
