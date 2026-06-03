# Task: IR link click is dead in the webview (window.open sandboxed)

> **Status:** ⬜ Not started.
> **Source:** `tuanpmt/vditor` `d9ba522` "fix(ir): click on link opens edit mode instead of opening URL". Verified still present in our `vditor@3.11.2` (evidence in Problem below).
> **Value / Risk:** 🟢🟢 fixes a dead interaction in our exact environment / low (config-level, no source patch)

## Problem
Clicking a link in **IR mode** does nothing useful in our webview. Vditor's `ir/index.ts:154-162` runs:
```ts
} else if (vditor.options.link.isOpen) {
    window.open(aElement.querySelector(":scope > .vditor-ir__marker--link").textContent);  // :160
}
return;  // :162 — early return prevents entering edit mode
```
Default `link.isOpen` is `true` (`util/Options.ts:68-69`) and our `new Vditor(...)` (`media-src/src/main.ts:332-355`) passes **no** `link` option and **no** `link.click` callback. In a VS Code webview `window.open` to an external URL is sandboxed/inert, so the click neither navigates nor places the caret for editing → the link feels broken.

Note: the extension already has an `onOpenLink` host handler that routes external URLs to the OS browser (used by "About vMarkd" and `open-link` messages), so the plumbing to open links *properly* already exists — IR just isn't using it.

## Goal
Clicking a link in IR does something correct and intentional: either (a) enters inline edit mode, or (b) opens the URL via the host (OS browser) — decided deliberately, not silently dead.

## Steps
1. **Decide behavior** (recommend: Ctrl/Cmd+click opens externally via host, plain click enters edit):
   - Pass a `link.click` callback in `media-src/src/main.ts` Vditor options. The callback receives the link marker element; read the URL and `postMessage({ command: 'open-link', href })` to the host (reuse the existing `open-link`/`onOpenLink` path in `src/extension.ts`).
   - For plain click → edit, set `link: { isOpen: false }` so the early `return` path that blocks edit-mode isn't taken (verify IR then places the caret/expands the marker as for normal text).
   - Optionally gate external-open on Ctrl/Cmd (check the original `event` modifiers) to match Ficus `116aec9` ("only ctrl+click follows links").
2. Verify WYSIWYG and SV link-click behavior is consistent with the choice (check `wysiwyg/index.ts` / `sv` link handling; align so all three modes behave the same).
3. Make sure this doesn't double-handle with the existing `onOpenLink` for non-IR contexts.

## See also
- `src/extension.ts` — existing `open-link` / `onOpenLink` → `vscode.env.openExternal` path.
- `media-src/node_modules/vditor/src/ts/ir/index.ts:154-162`, `util/Options.ts:68-69`.

## Reported upstream (repro + verify these)
- Vditor **#1476** — IR: pasting reference-style links adds a URL after each link on mode switch (link handling/round-trip near the same code). Verify our link-click change doesn't worsen it; ideally confirm it's unaffected. https://github.com/Vanessa219/vditor/issues/1476
- Vditor **PR #1899** — "Refactor link creation logic in fixBrowserBehavior.ts" (paste hyperlink uses URL as title) — same link area; reference when touching link behavior. https://github.com/Vanessa219/vditor/pull/1899

## Verify
In IR: plain-click a link → caret enters the link for editing (or your chosen behavior); Ctrl/Cmd-click → opens in the OS browser via the host. No silent dead click. Same behavior verified in WYSIWYG and SV.
