#!/usr/bin/env bash
set -euo pipefail

git pull --ff-only origin main
npm version patch

version="$(node -p "require('./package.json').version")"

perl -0pi -e "s{code --install-extension ./artifacts/vmarkd-[0-9]+\.[0-9]+\.[0-9]+\.vsix}{code --install-extension ./artifacts/vmarkd-${version}.vsix}" README.md

bun ./build.ts
bunx @vscode/vsce package --out "artifacts/vmarkd-${version}.vsix"
bun run publish:marketplace
git push origin main --tags
