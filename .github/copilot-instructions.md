When working in this repository, treat VSIX packaging as a release step.

- If asked to create, build, or package a VSIX for this extension, always bump the extension version first before packaging.
- Update every repository version source that must stay aligned, including `package.json` and `package-lock.json` when both exist.
- After the version bump, build the project, then create the VSIX artifact for the new version.
- Never overwrite, replace, rename, or delete an existing `.vsix` artifact in `artifacts/` as part of packaging. Always create a new versioned VSIX file alongside the existing ones.
- If the user explicitly asks for a package without mentioning versioning, still perform the version bump before packaging unless they explicitly forbid changing the version.

## Publishing and Updating on the Marketplace

When asked to publish or update the extension on the Marketplace, follow this workflow:

1. **Persist Credentials Once**: Keep the Visual Studio Marketplace PAT in the local `.env` file as `VSCE_PAT=...` and mirror it to the repository GitHub Actions secrets `VSCE_PAT` and `VS_MARKETPLACE_TOKEN`.
2. **Use the Automated Release Command**: Run `npm run release:marketplace` from the repository root.
3. **What the Release Command Does**:
   - fast-forwards from `origin/main`
   - bumps the patch version in aligned package files
   - updates the `README.md` install example to the new VSIX version
   - rebuilds the extension assets
   - packages `artifacts/vmarkd-[version].vsix`
   - loads `VSCE_PAT` from `.env` automatically and publishes with `@vscode/vsce`
   - pushes `main` and the new tag to GitHub
4. **GitHub Actions Automation**: `publish.yml` is the automatic Marketplace workflow for `v*` tags. Keep `main.yml` as a manual fallback only.
5. **Never Prompt for the PAT Again**: If `.env` or the GitHub secret already exists, use it directly instead of asking the user again.