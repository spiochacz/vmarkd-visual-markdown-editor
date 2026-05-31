// Empty stand-ins for Vditor toolbar buttons we never enable (task 20). Vditor's
// `toolbar/index.ts` statically imports Br/Fullscreen/Record/Export and switches
// on them, so esbuild can't drop them by tree-shaking alone — build.mjs redirects
// those four imports here, dropping their (export/record/fullscreen) deps. Our
// toolbar uses `Divider` for `|` separators, not `Br`, and none of these four, so
// these classes are never actually constructed at runtime.

class StubElement {
  public element: HTMLElement = document.createElement('div')
}

export class Br extends StubElement {}
export class Fullscreen extends StubElement {}
export class Record extends StubElement {}
export class Export extends StubElement {}
