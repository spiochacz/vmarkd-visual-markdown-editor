# Task 80 — Bump GitHub Actions off the deprecated Node 20 runtime

**Status:** TODO (low priority; do at the next release touch-up)

> **Source:** CI annotation on the v1.0.0 `Publish` run (2026-06-07).
> **Value / Risk:** 🟢 keep CI working past the deprecation / trivial.

## Problem

GitHub is retiring the Node 20 action runtime:

- **2026-06-16** — runners force JS actions to Node 24 by default.
- **2026-09-16** — Node 20 removed from the runner entirely.

Our pinned actions still run on Node 20, so every workflow run prints:

> Node.js 20 actions are deprecated … actions/checkout@v4, actions/setup-node@v4 …

Nothing breaks today (warning only), but after the dates above an un-bumped
action can stop working.

## Affected actions (all under `.github/workflows/`)

| File | Action | Now | Target |
|------|--------|-----|--------|
| `ci.yml` | `actions/checkout` | `@v4` | `@v5` |
| `ci.yml` | `actions/setup-node` | `@v4` | `@v5` |
| `ci.yml` | `actions/cache` | `@v4` | latest (verify `@v4` already runs on Node 24; bump only if not) |
| `publish.yml` | `actions/checkout` | `@v4` | `@v5` |
| `publish.yml` | `actions/setup-node` | `@v4` | `@v5` |
| `release.yml` | `actions/checkout` | `@v4` | `@v5` |
| `release.yml` | `actions/setup-node` | `@v4` | `@v5` |

(`release.yml`'s `uses: ./.github/workflows/publish.yml` is a local reusable
workflow, not a Node action — nothing to bump there.)

## Steps

1. Bump `actions/checkout@v4` → `@v5` and `actions/setup-node@v4` → `@v5` in all
   three workflows. Confirm `setup-node@v5` keeps the same inputs we use
   (`node-version: 22`, `cache: 'npm'`) — they are unchanged across v4→v5.
2. Check `actions/cache` — `@v4` may already run on Node 24; bump to the latest
   major only if the deprecation annotation still mentions it.
3. (Optional) Quick alternative to dodge the warning without a version bump: set
   `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` as a workflow `env`. Prefer the
   real bump — the env flag is a stopgap.

## Verify

- Open a PR (or re-run `ci.yml`) → no Node 20 deprecation annotation.
- A `Publish` / `Release` dry run still builds, tests, and packages the `.vsix`.

## Ref

- https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/
