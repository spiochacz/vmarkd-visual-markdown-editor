// Task 530 — build-time patch of the vendored Lute (GopherJS) blob so a hard line break keeps its
// source form (`␣␣`+ / `\`) end to end. Eight anchors: parser (2: parseNewline, parseBackslash), editor
// renderers (2: IR, WYSIWYG — emit `<br data-marker>`), DOM walkers (2: read the marker back), format
// renderer (1: write the form) and domText0 (1: IR's text serialization of inline spans).
//
// GopherJS note: a Go string / []byte reaches JS as UTF-8 BYTES in JS characters, so a sentinel the
// anchors compare against (caret U+2038, ZWSP U+200B) is written as its byte sequence
// (\xE2\x80\xB8, \xE2\x80\x8B), never as the Unicode character.
//
// Applied to the media/ COPY only — the pinned vendor file and its sha stay pristine. Every anchor must
// match exactly once; a Lute bump that moves one fails the build loudly.
//
// RE-PIN PROCEDURE: see tasks/done/530-hard-line-breaks-lost-on-edit.md. Tests: lute-hard-break-patch.test.ts.

const RENDER_FIND = (fn) =>
  `prototype.renderHardBreak=function ${fn}(a,b){var a,b,c;c=this;if(b){c.BaseRenderer.Tag("br",DN.nil,true);}return 2;};`
const RENDER_REPLACE = (fn) =>
  `prototype.renderHardBreak=function ${fn}(a,b){var a,b,c;c=this;if(b){c.BaseRenderer.Tag("br",a.Tokens.$length>1?new DN([new DF(["data-marker",$bytesToString($subslice(a.Tokens,0,a.Tokens.$length-1>>0))])]):DN.nil,true);}return 2;};`

/** [label, find, replace] — each `find` must occur exactly once in the stock blob. */
export const LUTE_HARD_BREAK_PATCHES = [
  [
    'P1 parseNewline',
    'if(i){f.Type=31;}return f;};',
    'if(i){f.Type=31;f.Tokens=new EU($stringToBytes($bytesToString($subslice(k,n[1].$length))+"\\n"));}return f;};',
  ],
  [
    'P2 parseBackslash',
    'if(10===i){e.pos=e.pos+(1)>>0;return new C.Node.ptr("","","","",31,EX.nil,EX.nil,EX.nil,EX.nil,EX.nil,EY.nil,new EU([i]),',
    'if(10===i){e.pos=e.pos+(1)>>0;return new C.Node.ptr("","","","",31,EX.nil,EX.nil,EX.nil,EX.nil,EX.nil,EY.nil,new EU([92,i]),',
  ],
  ['R_O wysiwyg renderHardBreak', RENDER_FIND('HF'), RENDER_REPLACE('HF')],
  ['R_S ir renderHardBreak', RENDER_FIND('PO'), RENDER_REPLACE('PO')],
  [
    "W_IR walker",
    "ab.Type=10;ab.Tokens=(new BS($stringToBytes(\"<br />\")));b.Context.Tip.AppendChild(ab);$s=-1;return;}if(3073===a.Parent.DataAtom){",
    "ab.Type=10;ab.Tokens=(new BS($stringToBytes(\"<br />\")));b.Context.Tip.AppendChild(ab);$s=-1;return;}d=K.DomAttrValue(a,\"data-marker\");if(/^(?:[ \\t]+|\\\\)$/.test(d)){ab.Type=31;ab.Tokens=(new BS($stringToBytes(d+\"\\n\")));b.Context.Tip.AppendChild(ab);$s=-1;return;}if(!(CB.nil===a.PrevSibling)&&\"br\"===a.PrevSibling.Data&&/^(?:[ \\t]+|\\\\)$/.test(K.DomAttrValue(a.PrevSibling,\"data-marker\"))&&CB.nil===a.NextSibling){$s=-1;return;}if(3073===a.Parent.DataAtom){",
  ],
  [
    "W_WYS walker",
    "z.Type=10;z.Tokens=(new BS($stringToBytes(\"<br />\")));b.Context.Tip.AppendChild(z);$s=-1;return;}if(3073===a.Parent.DataAtom){",
    "z.Type=10;z.Tokens=(new BS($stringToBytes(\"<br />\")));b.Context.Tip.AppendChild(z);$s=-1;return;}d=K.DomAttrValue(a,\"data-marker\");if(/^(?:[ \\t]+|\\\\)$/.test(d)){z.Type=31;z.Tokens=(new BS($stringToBytes(d+\"\\n\")));b.Context.Tip.AppendChild(z);$s=-1;return;}if(!(CB.nil===a.PrevSibling)&&\"br\"===a.PrevSibling.Data&&/^(?:[ \\t]+|\\\\)$/.test(K.DomAttrValue(a.PrevSibling,\"data-marker\"))&&CB.nil===a.NextSibling){$s=-1;return;}if(3073===a.Parent.DataAtom){",
  ],
  [
    "F_CO format renderHardBreak",
    "prototype.renderHardBreak=function BHL(a,b){var a,b,c;c=this;if(b){if(!c.BaseRenderer.Options.SoftBreak2HardBreak){c.BaseRenderer.WriteString(\"\\\\\\n\");}else{if(a.ParentIs(109,ET.nil)){c.BaseRenderer.WriteString(\"<br/>\");}else{c.BaseRenderer.WriteByte(10);}}}return 2;};",
    "prototype.renderHardBreak=function BHL(a,b){var a,b,c,d,e,f,g,h,i;c=this;if(b){d=a.Tokens.$length>1?$bytesToString(a.Tokens):\"\";h=/^(?:[ \\t]+|\\\\)\\n$/;g=a.Previous;i=!(EH.nil===g)&&(31===g.Type)&&h.test($bytesToString(g.Tokens));if(!c.BaseRenderer.Options.SoftBreak2HardBreak){c.BaseRenderer.WriteString(\"\\\\\\n\");}else if(a.ParentIs(109,ET.nil)){c.BaseRenderer.WriteString(\"<br/>\");}else{e=a.Next;f=false;while(!(EH.nil===e)){if(16===e.Type){g=$bytesToString(e.Tokens);if(g.indexOf(\"\\xE2\\x80\\xB8\")>=0){f=true;}if(/[^ \\t\\r\\n]/.test(g.replace(/\\xE2\\x80[\\xB8\\x8B]/g,\"\"))){break;}}else if(31===e.Type){if(!h.test($bytesToString(e.Tokens))){if(!f){e=EH.nil;break;}}}else{break;}e=e.Next;}if(!h.test(d)){if(!(i&&EH.nil===e&&!f)){c.BaseRenderer.WriteByte(10);}}else if(EH.nil===e&&!f){if(!i){c.BaseRenderer.WriteByte(10);}}else{if(92!==d.charCodeAt(0)){g=a.Previous;if(EH.nil===g||(31===g.Type)||((16===g.Type)&&!/[^ \\t\\r\\n]/.test($bytesToString(g.Tokens).replace(/\\xE2\\x80\\x8B/g,\"\")))){d=\"\\\\\\n\";}}c.BaseRenderer.WriteString(d);}}}return 2;};",
  ],
  [
    "D_TXT domText0 br",
    "else if(f===(514)){b.WriteString(\"\\n\");}else if(f===(3073)){b.WriteString(\"\\n\\n\");}",
    "else if(f===(514)){c=AW(a,\"data-marker\");e=a.Parent;while(!(BX.nil===e)){if((3===e.Type)&&(\"pre\"===e.Data||\"code\"===e.Data||\"kbd\"===e.Data||(\"span\"===e.Data&&/^(?:code|math-inline|html-inline)$/.test(AW(e,\"data-type\"))))){c=\"\";break;}e=e.Parent;}b.WriteString(/^(?:[ \\t]+|\\\\)$/.test(c)?c+\"\\n\":\"\\n\");}else if(f===(3073)){b.WriteString(\"\\n\\n\");}",
  ],
]

// Task 532 step 6 — a loose list (blank line between items) keeps its looseness through DOM → markdown.
// Lute already marks it in the DOM (`data-tight="true"` on a tight list, item content wrapped in `<p>`
// with no data-tight on a loose one), but the DOM walkers first run `adjustVditorDOMListTight0`, which
// OVERWRITES `data-tight` from `isTightList` — a structural guess that calls every list with at most
// one `<p>` per item tight. L1 amends that guess: a list that does not declare `data-tight="true"`
// and has an item with a direct `<p>` is loose. A list that DOES declare it keeps the old verdict,
// so task 391's contradictory DOM (tight list + one wrapped item, from Backspace) is still repaired
// by list-tight.ts rather than flipped loose here. L2 teaches the markdown (format) renderer to
// WRITE it (its list item always ended with one newline); L3 does the same for the split-view (sv)
// renderer, which trimmed every item's trailing newlines. Every consumer (getValue, spin, the
// incremental serializeForHost path, Preview, host write-back) goes through these walkers.
export const LUTE_LOOSE_LIST_PATCHES = [
  [
    'L1 isTightList',
    'prototype.isTightList=function DP(a){var a,b,c,d,e,f,g,h,i,j,k,l,m;b=this;c=a.FirstChild;',
    'prototype.isTightList=function DP(a){var a,b,c,d,e,f,g,h,i,j,k,l,m;b=this;if("true"!==K.DomAttrValue(a,"data-tight")){c=a.FirstChild;while(!(CB.nil===c)){l=c.FirstChild;while(!(CB.nil===l)){if(3073===l.DataAtom){return"false";}l=l.NextSibling;}c=c.NextSibling;}}c=a.FirstChild;',
  ],
  [
    'L2 format renderListItem',
    'c.BaseRenderer.Write(k);if(!a.ParentIs(109,ET.nil)){c.BaseRenderer.WriteString("\\n");}case 3:$s=-1;return 2;}return;}var $f={$blk:BHI,',
    'c.BaseRenderer.Write(k);if(!a.ParentIs(109,ET.nil)){c.BaseRenderer.WriteString(!(EH.nil===a.Parent)&&!(FC.nil===a.Parent.ListData)&&!a.Parent.ListData.Tight?"\\n\\n":"\\n");}case 3:$s=-1;return 2;}return;}var $f={$blk:BHI,',
  ],
  [
    'L3 sv renderListItem',
    'g=c.BaseRenderer.Writer.Bytes();c.BaseRenderer.Writer.Reset();c.Write(g);c.Write($pkg.NewlineSV);}return 2;};$ptrType(Q).prototype.renderTaskListItemMarker=',
    'g=c.BaseRenderer.Writer.Bytes();c.BaseRenderer.Writer.Reset();c.Write(g);c.Write($pkg.NewlineSV);if(!(EH.nil===a.Next)&&!(EH.nil===a.Parent)&&!(FC.nil===a.Parent.ListData)&&!a.Parent.ListData.Tight){c.Write($pkg.NewlineSV);}}return 2;};$ptrType(Q).prototype.renderTaskListItemMarker=',
  ],
]

// Task 532 step 7 — a task-list checkbox keeps its source form through DOM → markdown: `[x]` / `[X]`
// as written and exactly ONE space before the text (it used to come back `[X]  a` — upper-cased and
// double-spaced). The AST already records the raw marker rune; three things lost it on the way:
//   - Effective marker: `x` was reported as `X`, and a checked box without a recorded marker as `X`
//     (also what the split-view renderer SHOWS — the sv pane displayed `[X]` for a `[x]` source).
//     Now `x` stays `x`; the canonical checked form is the GitHub-style lowercase `x`.
//   - the IR / WYSIWYG renderers emit `data-task` on the checkbox only when the marker is `X` (the
//     one form the DOM `checked` attribute cannot carry); the walkers read it back via
//     ReviveFromDataTask, which now trusts it only while the box is still `checked` (a toggled-off
//     box is ` `, a toggled-on one whose attribute says nothing useful is `x`).
//   - the markdown (format) renderer re-normalised every marker that is not ` ` / `X` to `X`; `x` now passes.
//   - the IR walker left the text node's leading space (the DOM spells `<input> a`) in place, and the
//     format renderer writes its own space after the marker → two. The WYSIWYG walker already trims it.
export const LUTE_TASK_LIST_PATCHES = [
  [
    'T1 EffectiveTaskListItemMarker',
    'if(b.TaskListItemMarker===120){return"X";}return F.EscapeHTMLStr(($encodeRune(b.TaskListItemMarker)));}if(b.TaskListItemChecked){return"X";}return" ";',
    'if(b.TaskListItemMarker===120){return"x";}return F.EscapeHTMLStr(($encodeRune(b.TaskListItemMarker)));}if(b.TaskListItemChecked){return"x";}return" ";',
  ],
  [
    'T2 ReviveFromDataTask',
    'if(1===b.length){e=b.charCodeAt(0);}else if(c){e=88;}else{e=32;}d.ReviveFromMarker(e);',
    'if(c){e=("X"===b)?88:120;}else{e=32;}d.ReviveFromMarker(e);',
  ],
  [
    'T3 ir renderTaskListItemMarker',
    'prototype.renderTaskListItemMarker=function HD(a,b){var a,b,c,d,e;c=this;if(b){d=DN.nil;if(a.TaskListItemChecked){d=$append(d,new DF(["checked",""]));}d=$append(d,new DF(["type","checkbox"]));if(c.BaseRenderer.Options.DataTask){',
    'prototype.renderTaskListItemMarker=function HD(a,b){var a,b,c,d,e;c=this;if(b){d=DN.nil;if(a.TaskListItemChecked){d=$append(d,new DF(["checked",""]));}d=$append(d,new DF(["type","checkbox"]));if(c.BaseRenderer.Options.DataTask||88===a.TaskListItemMarker){',
  ],
  [
    'T4 wysiwyg renderTaskListItemMarker',
    'prototype.renderTaskListItemMarker=function PM(a,b){var a,b,c,d,e;c=this;if(b){d=DN.nil;if(a.TaskListItemChecked){d=$append(d,new DF(["checked",""]));}d=$append(d,new DF(["type","checkbox"]));if(c.BaseRenderer.Options.DataTask){',
    'prototype.renderTaskListItemMarker=function PM(a,b){var a,b,c,d,e;c=this;if(b){d=DN.nil;if(a.TaskListItemChecked){d=$append(d,new DF(["checked",""]));}d=$append(d,new DF(["type","checkbox"]));if(c.BaseRenderer.Options.DataTask||88===a.TaskListItemMarker){',
  ],
  [
    'T5 ir walker checkbox',
    'ab.Type=100;ab.ReviveFromDataTask(K.DomAttrValue(a,"data-task"),c.hasAttr(a,"checked"));',
    'ab.Type=100;if(!(CB.nil===a.NextSibling)&&1===a.NextSibling.Type){a.NextSibling.Data=P.TrimLeft(a.NextSibling.Data," ");}ab.ReviveFromDataTask(K.DomAttrValue(a,"data-task"),c.hasAttr(a,"checked"));',
  ],
  [
    'T6 NormalizedTaskListItemMarker',
    'if(!(c===" ")&&!(c==="X")){c="X";}',
    'if(!(c===" ")&&!(c==="X")&&!(c==="x")){c="X";}',
  ],
]

// Task 532 step 7 (sv) — the split-view source pane keeps a blank line INSIDE a list item blank. Its
// list-item renderer prefixes EVERY newline of the item with the item's padding span, so a blank line
// between two paragraphs of one item (or inside its fenced code) came out as the whitespace-only
// line "  " (the pane's textContent is what gets saved). The anchor collapses `newline padding
// [empty padding] newline` back to `newline [empty padding] newline`, looped so a run of blank lines
// collapses fully: the padding still follows the LAST newline of the run, where the next real
// line's indentation belongs. Whitespace-only lines with real content (code) are untouched.
export const LUTE_SV_PADDING_PATCHES = [
  [
    'S1 sv renderListItem padding',
    'g=A.ReplaceAll(g,$pkg.NewlineSV,$appendSlice($pkg.NewlineSV,j));',
    'k=$bytesToString($pkg.NewlineSV);l=$bytesToString(j);n=$bytesToString(g).split(k).join(k+l);m=\'<span data-type="padding"></span>\';while(n.indexOf(k+l+k)>=0||n.indexOf(k+l+m+k)>=0){n=n.split(k+l+k).join(k+k).split(k+l+m+k).join(k+m+k);}g=new DE($stringToBytes(n));',
  ],
]

/**
 * Pure string transform: the stock Lute blob → the hard-break-, loose-list- and task-list-aware one. Idempotent
 * (an already patched blob is returned unchanged). Throws when an anchor is missing or ambiguous.
 */
export function patchLuteBlob(src) {
  let out = src
  for (const [label, find, replace] of [
    ...LUTE_HARD_BREAK_PATCHES,
    ...LUTE_LOOSE_LIST_PATCHES,
    ...LUTE_TASK_LIST_PATCHES,
    ...LUTE_SV_PADDING_PATCHES,
  ]) {
    const first = out.indexOf(find)
    if (first === -1 && out.includes(replace)) continue // already patched
    if (first === -1 || out.indexOf(find, first + 1) !== -1) {
      const n = first === -1 ? '0' : '2+'
      throw new Error(
        `[lute] anchor "${label}" matched ${n} times (expected 1) — Lute changed; re-derive anchors (see tasks/done/530-hard-line-breaks-lost-on-edit.md)`,
      )
    }
    out = out.replace(find, () => replace)
  }
  return out
}
