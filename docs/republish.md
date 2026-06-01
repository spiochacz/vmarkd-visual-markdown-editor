---
description: "How to republish/update the VS Code extension on the Marketplace."
---
// turbo-all
Follow these steps to update the extension to a new version on the VS Code Marketplace.

### 1. Sync & Version Bump
Ensure your local repository is up to date and bump the version number:

```bash
git pull origin main
npm version patch
```
*Note: This automatically updates `package.json` and `package-lock.json` and creates a git tag.*

### 2. Update Documentation
Update any version-specific links or installation instructions in `README.md`.

### 3. Build & Package
Re-bundle the assets and generate the VSIX package:

```bash
# Re-bundle the webview editor assets
npx foy build

# Create the production VSIX artifact
npx vsce package --out artifacts/vmarkd-$(node -p "require('./package.json').version").vsix
```

### 4. Direct Marketplace Publication
Deploy the new version using the Personal Access Token (PAT).

```bash
npx @vscode/vsce publish -p <YOUR_VS_MARKETPLACE_PAT>
```

### 5. Finalize Git
Push the version bump and the new tag to GitHub:

```bash
git push origin main --tags
```
