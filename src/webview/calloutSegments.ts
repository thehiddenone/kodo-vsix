// ---------------------------------------------------------------------------
// Kodo callout splitting (pure, no preact — unit-tested directly).
//
// Splits message text into plain-markdown spans and `<kodo…>…</kodo…>`
// callout spans for markdown.tsx to render. Code is opaque: a callout tag
// inside a ``` … ``` fenced block or a `…` inline code span is code, never an
// opening or closing tag. The fence and code-span rules are the same regexes
// markdown.tsx's parsers use, so "what is code" means the same thing in both
// places — including an unterminated fence, which runs to the end of the text
// (streamed content).
//
// A callout is a top-level block: its content is rendered as a stand-alone
// markdown document inside the callout box. So a code block may end on the
// same line as the callout's closing tag ("```</kodo>"), and a callout may
// start right after a closing fence ("``` <kodo>"): see
// FENCE_CLOSE_BEFORE_TAG_RE.
// ---------------------------------------------------------------------------

export type KodoVariant = 'kodo_info' | 'kodo_warn' | 'kodo_crit' | 'kodo';

export type CalloutSegment =
  | { kind: 'markdown'; text: string }
  | { kind: 'callout'; variant: KodoVariant; inner: string };

// A line that opens a fenced code block, and a line that closes one.
export const FENCE_OPEN_RE = /^\s*```/;
export const FENCE_CLOSE_RE = /^\s*```\s*$/;
// A line that closes a fence and continues with a callout tag, e.g.
// "```</kodo>" or "``` <kodo_info>". The match is the fence part; the rest of
// the line (starting at the tag) is outside the code block.
export const FENCE_CLOSE_BEFORE_TAG_RE = /^\s*```\s*(?=<\/?(?:kodo_info|kodo_warn|kodo_crit|kodo)>)/;
// An inline code span. markdown.tsx renders inline markdown one line at a
// time, so a span never crosses a line break.
export const INLINE_CODE_RE = /`([^`]+)`/;

// Opening tag of any kodo callout. More specific names come first so that, e.g.
// `<kodo_info>` is never mis-read as `<kodo>` followed by stray text.
const KODO_OPEN_RE = /<(kodo_info|kodo_warn|kodo_crit|kodo)>/g;

// [start, end) character ranges of the inline code spans in `line`, which
// starts at offset `pos` of the text.
function inlineCodeRanges(line: string, pos: number): [number, number][] {
  const spanRe = new RegExp(INLINE_CODE_RE.source, 'g');
  return [...line.matchAll(spanRe)].map((m) => [pos + m.index, pos + m.index + m[0].length]);
}

// [start, end) character ranges of the code in `text`: fenced blocks (fence
// lines included; an unterminated fence extends to the end of the text) and
// inline code spans on the lines outside them.
function codeRanges(text: string): [number, number][] {
  const ranges: [number, number][] = [];
  let pos = 0;
  let openAt: number | null = null;
  for (const line of text.split('\n')) {
    const lineEnd = pos + line.length;
    if (openAt === null) {
      if (FENCE_OPEN_RE.test(line)) {
        openAt = pos;
      } else {
        ranges.push(...inlineCodeRanges(line, pos));
      }
    } else if (FENCE_CLOSE_RE.test(line)) {
      ranges.push([openAt, lineEnd]);
      openAt = null;
    } else {
      const close = FENCE_CLOSE_BEFORE_TAG_RE.exec(line);
      if (close) {
        const fenceEnd = pos + close[0].length;
        ranges.push([openAt, fenceEnd]);
        ranges.push(...inlineCodeRanges(line.slice(close[0].length), fenceEnd));
        openAt = null;
      }
    }
    pos = lineEnd + 1;
  }
  if (openAt !== null) {
    ranges.push([openAt, text.length]);
  }
  return ranges;
}

// First match of the global regex `re` in `text` that does not start inside a
// code range.
function execOutsideCode(re: RegExp, text: string): RegExpExecArray | null {
  const ranges = codeRanges(text);
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const at = m.index;
    if (!ranges.some(([start, end]) => at >= start && at < end)) {
      return m;
    }
  }
  return null;
}

// Split top-level content into callout and plain-markdown segments. An
// unterminated callout tag consumes the rest of the text.
export function splitCallouts(text: string): CalloutSegment[] {
  const out: CalloutSegment[] = [];
  let rest = text;
  while (rest.length > 0) {
    const m = execOutsideCode(KODO_OPEN_RE, rest);
    if (!m) {
      out.push({ kind: 'markdown', text: rest });
      break;
    }
    const before = rest.slice(0, m.index);
    if (before.trim() !== '') {
      out.push({ kind: 'markdown', text: before });
    }
    const variant = m[1] as KodoVariant;
    const afterOpen = rest.slice(m.index + m[0].length);
    const cm = execOutsideCode(new RegExp(`</${variant}>`, 'g'), afterOpen);
    if (cm) {
      out.push({ kind: 'callout', variant, inner: afterOpen.slice(0, cm.index) });
      rest = afterOpen.slice(cm.index + cm[0].length);
    } else {
      out.push({ kind: 'callout', variant, inner: afterOpen }); // unclosed → the remainder
      rest = '';
    }
  }
  return out;
}
