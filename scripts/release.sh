#!/usr/bin/env bash
# Release script: bumps version in all package.json files, commits, and tags.
# Usage: bash scripts/release.sh <version>
# Example: bash scripts/release.sh 0.2.0

VERSION="$1"

if [ -z "$VERSION" ]; then
    echo "Usage: bash scripts/release.sh <version>"
    echo "Example: bash scripts/release.sh 0.2.0"
    exit 1
fi

# Validate semver format
if ! echo "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$'; then
    echo "Error: '$VERSION' is not a valid semver version (expected: X.Y.Z)"
    exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Check for uncommitted changes
if [ -n "$(git -C "$ROOT" status --porcelain)" ]; then
    echo "Error: Working directory has uncommitted changes. Commit or stash them first."
    exit 1
fi

# Check if tag already exists
if git -C "$ROOT" tag -l "v$VERSION" | grep -q "v$VERSION"; then
    echo "Error: Tag v$VERSION already exists."
    exit 1
fi

echo "Bumping version to $VERSION ..."

# Update all package.json files
for PKG in "$ROOT/package.json" "$ROOT/frontend/package.json" "$ROOT/backend/package.json"; do
    if [ -f "$PKG" ]; then
        # Use node for reliable JSON editing
        node -e "
            const fs = require('fs');
            const pkg = JSON.parse(fs.readFileSync('$PKG', 'utf8'));
            const old = pkg.version;
            pkg.version = '$VERSION';
            fs.writeFileSync('$PKG', JSON.stringify(pkg, null, 4) + '\n');
            console.log('  ' + '$PKG'.replace('$ROOT/', '') + ': ' + old + ' → $VERSION');
        "
    fi
done

echo ""
echo "Committing and tagging ..."
git -C "$ROOT" add -A
git -C "$ROOT" commit -m "release: v$VERSION"
git -C "$ROOT" tag -a "v$VERSION" -m "Release v$VERSION"

echo ""
echo "Building Chrome Extension ..."
(cd "$ROOT/frontend" && npm run build:extension)

ZIP_NAME="procura-v$VERSION.zip"
echo "Creating $ZIP_NAME ..."
(cd "$ROOT/frontend/dist-extension" && zip -r "$ROOT/$ZIP_NAME" .)

echo ""
echo "Pushing to origin ..."
git -C "$ROOT" push origin main --tags

echo ""
echo "Creating GitHub Release ..."
gh release create "v$VERSION" "$ROOT/$ZIP_NAME" \
    --title "v$VERSION" \
    --notes "See [CHANGELOG.md](CHANGELOG.md) for details."

# Clean up local zip
rm -f "$ROOT/$ZIP_NAME"

echo ""
echo "✅ Released v$VERSION"
echo "   → GitHub Release: https://github.com/$(gh repo view --json nameWithOwner -q .nameWithOwner)/releases/tag/v$VERSION"

