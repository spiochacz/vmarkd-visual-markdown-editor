When working in this repository, treat VSIX packaging as a release step.

- If asked to create, build, or package a VSIX for this extension, always bump the extension version first before packaging.
- Update every repository version source that must stay aligned, including `package.json` and `package-lock.json` when both exist.
- After the version bump, build the project, then create the VSIX artifact for the new version.
- Never overwrite, replace, rename, or delete an existing `.vsix` artifact in `artifacts/` as part of packaging. Always create a new versioned VSIX file alongside the existing ones.
- If the user explicitly asks for a package without mentioning versioning, still perform the version bump before packaging unless they explicitly forbid changing the version.

## Publishing and Updating on the Marketplace

When asked to publish or update the extension on the Marketplace, follow this workflow:

1. **Persist Credentials Once**: Keep the Visual Studio Marketplace PAT in the local `.env` file as `VSCE_PAT=...` and mirror it to the repository GitHub Actions secrets `VSCE_PAT` and `VS_MARKETPLACE_TOKEN`.
2. **Cut a release**: bump the version (`npm version <ver>` — commits + tags — or edit `package.json` and commit), then run `npm run release:marketplace` (aka `npm run pub`).
3. **What the release command does**: fast-forwards from `origin/main`, tags the current `package.json` version (`v<version>`), and pushes `main` + the tag. It does NOT build, package, or publish locally — CI owns that.
4. **GitHub Actions automation**: pushing the `v*` tag triggers `publish.yml` ("Release"), which builds, tests, packages the `.vsix`, creates a **GitHub Release** with the `.vsix` attached, then publishes to the VS Marketplace (`VSCE_PAT` / `VS_MARKETPLACE_TOKEN`) and Open VSX (`OPEN_VSX_TOKEN`) — each only if that token secret is set. The release step is idempotent, so the workflow is safely re-runnable from the Actions tab.
5. **Tokens are repo secrets**: configure `VSCE_PAT` / `OPEN_VSX_TOKEN` as GitHub repo secrets. With none set, the run still creates the GitHub Release with the `.vsix` — add a token later and re-run to publish to a registry.