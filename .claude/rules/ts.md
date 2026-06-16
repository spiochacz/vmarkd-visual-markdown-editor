---
paths:
  - "media-src/**/*.ts"
---
# TS commenting rules

- Every workaround, override, or non-obvious fix must have a comment explaining: what it fixes, why, and how
- All Vditor overrides (patched behaviour, observer hacks, esbuild rewrites) need a comment stating why the override exists and where it is consumed
- Comments go inline or directly above the relevant line — never in a distant block
- Straightforward logic that reads obviously from well-named identifiers needs no comment
