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

/**
 * Pure string transform: the stock Lute blob → the hard-break-aware one. Idempotent (an already
 * patched blob is returned unchanged). Throws when an anchor is missing or ambiguous.
 */
export function patchLuteBlob(src) {
  let out = src
  for (const [label, find, replace] of LUTE_HARD_BREAK_PATCHES) {
    const first = out.indexOf(find)
    if (first === -1 && out.includes(replace)) continue // already patched
    if (first === -1 || out.indexOf(find, first + 1) !== -1) {
      const n = first === -1 ? '0' : '2+'
      throw new Error(
        `[lute] hard-break anchor "${label}" matched ${n} times (expected 1) — Lute changed; re-derive anchors (see tasks/done/530-hard-line-breaks-lost-on-edit.md)`,
      )
    }
    out = out.replace(find, () => replace)
  }
  return out
}
