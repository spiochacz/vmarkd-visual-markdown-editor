# Task: Settings UI reorganization + allowRemoteImages namespace

> **Status:** ✅ DONE (2026-06-05).
> **Value / Risk:** 🟢 cleaner settings UX / low.

## Changes
1. **New "Image" section** (order 5) groups all image settings:
   `saveFolder`, `format`, `quality`, `maxWidth`, `allowRemoteImages`.
2. **`vmarkd.security.allowRemoteImages` → `vmarkd.image.allowRemoteImages`**:
   renamed to fit the Image namespace. All code + test references updated.
   The old key is no longer recognized (breaking for users who had it set —
   they need to re-set under the new key).
3. **Removed single-setting "Security" section** — `allowRemoteImages` moved
   into Image; the remaining Advanced settings stay in "Advanced" (order 6).
4. **Removed `vmarkd.outline.width` setting** — width is now drag-controlled
   and persisted in globalState (task 75). CSS default stays 200px.
