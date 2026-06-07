#!/usr/bin/env bash
set -euo pipefail

# Cut a release. Bump the version FIRST (e.g. `npm version 1.0.0`, or edit
# package.json + commit), then run this. It tags the current package.json version
# and pushes; CI (.github/workflows/publish.yml) then builds, creates the GitHub
# Release with the .vsix, and publishes to the Marketplace / Open VSX when those
# tokens are configured as repo secrets.

git pull --ff-only origin main

version="$(node -p "require('./package.json').version")"
tag="v${version}"

# Create the tag if it doesn't exist yet (`npm version` may have created it already).
git rev-parse -q --verify "refs/tags/${tag}" >/dev/null || git tag "$tag"

git push origin main "$tag"

echo "Pushed ${tag}. Track the release run with:  gh run watch"
