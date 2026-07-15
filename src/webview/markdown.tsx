import { h } from 'preact';
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { styles } from './styles';
// ---------------------------------------------------------------------------
// Markdown rendering
//
// A small, best-effort markdown renderer for agent message text. It is built
// to cope with *streamed*, partially-complete content: any unterminated
// block-level construct (a fenced code block or one of the kodo callout tags
// below) is treated as if it were auto-closed at the end of the text. Inline
// emphasis (**bold**, *italic*, `code`) is rendered only when properly paired,
// so transient half-typed markers and incidental characters such as the `*` in
// `2 * 3` or the `_` in snake_case identifiers are left as literal text rather
// than being force-closed and mangled.
//
// Four special callout tags are recognised on top of markdown:
//   <kodo_info>…</kodo_info>  ℹ️  blue    — progress / informational notes
//   <kodo_warn>…</kodo_warn>  ⚠️  yellow  — potential problems / contradictions
//   <kodo_crit>…</kodo_crit>  💥  red     — errors / blocking failures
//   <kodo>…</kodo>            ド  green   — good news / solved problems
// ---------------------------------------------------------------------------

type KodoVariant = 'kodo_info' | 'kodo_warn' | 'kodo_crit' | 'kodo';

const KODO_META = {
  kodo_info: {
    symbol: 'ℹ️',
    block: {
      margin: '10px 0',
      border: '1px solid rgba(74, 158, 255, 0.6)',
      background: 'rgba(74, 158, 255, 0.08)',
      borderRadius: '8px',
      padding: '8px 12px',
      display: 'flex',
      gap: '10px',
      alignItems: 'flex-start',
    },
    icon: { fontSize: '20px', lineHeight: 1.3, flexShrink: 0 },
  },
  kodo_warn: {
    symbol: '⚠️',
    block: {
      margin: '15px 0',
      border: '1px solid rgba(230, 184, 0, 0.7)',
      background: 'rgba(230, 184, 0, 0.08)',
      borderRadius: '8px',
      padding: '8px 12px',
      display: 'flex',
      gap: '10px',
      alignItems: 'flex-start',
    },
    icon: { fontSize: '20px', lineHeight: 1.3, flexShrink: 0 },
  },
  kodo_crit: {
    symbol: '💥',
    block: {
      margin: '20px 0',
      border: '1px solid rgba(255, 92, 92, 0.7)',
      background: 'rgba(255, 92, 92, 0.08)',
      borderRadius: '8px',
      padding: '8px 12px',
      display: 'flex',
      gap: '10px',
      alignItems: 'flex-start',
    },
    icon: { fontSize: '20px', lineHeight: 1.3, flexShrink: 0 },
  },
  kodo: {
    symbol: 'ド',
    block: {
      margin: '20px 0',
      border: '1px solid rgba(63, 185, 80, 0.7)',
      background: 'rgba(63, 185, 80, 0.08)',
      borderRadius: '8px',
      padding: '8px 12px',
      display: 'flex',
      gap: '10px',
      alignItems: 'flex-start',
    },
    icon: { fontSize: '22px', lineHeight: 1.2, flexShrink: 0, color: '#3fb950', fontWeight: 700 },
  },
};

// Opening tag of any kodo callout. More specific names come first so that, e.g.
// `<kodo_info>` is never mis-read as `<kodo>` followed by stray text.
const KODO_OPEN_RE = /<(kodo_info|kodo_warn|kodo_crit|kodo)>/;

// Inline patterns, tried in priority order. The earliest match in the text
// wins; ties are broken by this order (so `**` beats `*` at the same index).
const INLINE_PATTERNS: { re: RegExp; kind: 'code' | 'bold' | 'italic' | 'link' }[] = [
  { re: /`([^`]+)`/, kind: 'code' },
  { re: /\*\*([\s\S]+?)\*\*/, kind: 'bold' },
  { re: /(?<![A-Za-z0-9])__([\s\S]+?)__(?![A-Za-z0-9])/, kind: 'bold' },
  { re: /\*([\s\S]+?)\*/, kind: 'italic' },
  { re: /(?<![A-Za-z0-9])_([\s\S]+?)_(?![A-Za-z0-9])/, kind: 'italic' },
  { re: /\[([^\]]*)\]\(([^)\s]+)\)/, kind: 'link' },
];

// Split a single GFM table row into its cell texts, tolerating an optional
// leading/trailing `|` and unescaping `\|`.
function splitTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

// A table separator row looks like `| --- | :---: | ---: |` (dashes with
// optional alignment colons in every cell, at least one dash each).
function isTableSeparatorLine(line: string): boolean {
  const t = line.trim();
  if (!t.includes('-') || !t.includes('|')) return false;
  const cells = splitTableRow(t);
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
}

function tableAlignments(sepLine: string): (string | undefined)[] {
  return splitTableRow(sepLine).map((c) => {
    const left = c.startsWith(':');
    const right = c.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return undefined;
  });
}

function headingStyle(level: number): Record<string, unknown> {
  const sizes = ['1.5em', '1.35em', '1.2em', '1.1em', '1em', '0.95em'];
  return { ...styles.mdHeadingBase, fontSize: sizes[level - 1] };
}

// Render inline markdown (emphasis, code spans, links) inside a single span of
// text. Returns an array of preact children.
function parseInline(text: string, kp: string): ComponentChildren[] {
  const nodes: ComponentChildren[] = [];
  let rest = text;
  let k = 0;
  while (rest.length > 0) {
    let bestStart = Infinity;
    let bestKind: 'code' | 'bold' | 'italic' | 'link' | null = null;
    let bestMatch: RegExpExecArray | null = null;
    for (const p of INLINE_PATTERNS) {
      const m = p.re.exec(rest);
      if (m && m.index < bestStart) {
        bestStart = m.index;
        bestKind = p.kind;
        bestMatch = m;
      }
    }
    if (!bestMatch || bestKind === null) {
      nodes.push(rest);
      break;
    }
    if (bestStart > 0) nodes.push(rest.slice(0, bestStart));
    const m = bestMatch;
    const key = `${kp}-${k++}`;
    switch (bestKind) {
      case 'code':
        nodes.push(<code key={key} style={styles.mdCode}>{m[1]}</code>);
        break;
      case 'bold':
        nodes.push(<strong key={key} style={styles.mdBold}>{parseInline(m[1], key)}</strong>);
        break;
      case 'italic':
        nodes.push(<em key={key}>{parseInline(m[1], key)}</em>);
        break;
      case 'link':
        nodes.push(
          <a key={key} href={m[2]} style={styles.mdLink} target="_blank" rel="noreferrer">
            {parseInline(m[1], key)}
          </a>,
        );
        break;
    }
    rest = rest.slice(bestStart + m[0].length);
  }
  return nodes;
}

// Render block-level markdown (headings, lists, quotes, code fences,
// paragraphs, rules). Returns an array of preact children.
function parseBlocks(text: string, kp: string): ComponentChildren[] {
  const lines = text.split('\n');
  const blocks: ComponentChildren[] = [];
  let i = 0;
  let k = 0;
  const nextKey = () => `${kp}-${k++}`;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      i++;
      continue;
    }
    // Fenced code block (auto-closes at end of text if the closing fence is
    // missing — handles content still being streamed).
    if (/^\s*```/.test(line)) {
      i++;
      const code: string[] = [];
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        code.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // consume the closing fence
      blocks.push(<CodeBlock key={nextKey()} code={code.join('\n')} />);
      continue;
    }
    // Heading
    const hm = /^(#{1,6})\s+(.*)$/.exec(line);
    if (hm) {
      const level = hm[1].length;
      blocks.push(h(`h${level}`, { key: nextKey(), style: headingStyle(level) }, parseInline(hm[2], nextKey())));
      i++;
      continue;
    }
    // Horizontal rule (---, ***, ___, possibly spaced)
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push(<hr key={nextKey()} style={styles.mdHr} />);
      i++;
      continue;
    }
    // Blockquote
    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      blocks.push(
        <blockquote key={nextKey()} style={styles.mdQuote}>
          {parseBlocks(quote.join('\n'), nextKey())}
        </blockquote>,
      );
      continue;
    }
    // Table (GFM): a header row immediately followed by a `---|---` divider.
    if (line.includes('|') && i + 1 < lines.length && isTableSeparatorLine(lines[i + 1])) {
      const headerCells = splitTableRow(line);
      const aligns = tableAlignments(lines[i + 1]);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim() !== '' && lines[i].includes('|')) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      const tk = nextKey();
      blocks.push(
        <div key={tk} style={styles.mdTableWrap}>
          <table style={styles.mdTable}>
            <thead>
              <tr>
                {headerCells.map((c, ci) => (
                  <th key={`${tk}-h-${ci}`} style={{ ...styles.mdTh, textAlign: aligns[ci] ?? 'left' }}>
                    {parseInline(c, `${tk}-h-${ci}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={`${tk}-r-${ri}`}>
                  {r.map((c, ci) => (
                    <td key={`${tk}-r-${ri}-${ci}`} style={{ ...styles.mdTd, textAlign: aligns[ci] ?? 'left' }}>
                      {parseInline(c, `${tk}-r-${ri}-${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    // List (unordered or ordered) — single-level, best-effort.
    const listM = /^(\s*)([-*+]|\d+\.)\s+/.exec(line);
    if (listM) {
      const ordered = /\d+\./.test(listM[2]);
      const items: ComponentChildren[] = [];
      while (i < lines.length) {
        const lm = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(lines[i]);
        if (!lm) break;
        const ik = nextKey();
        items.push(
          <li key={ik} style={styles.mdLi}>
            {parseInline(lm[3], ik)}
          </li>,
        );
        i++;
      }
      blocks.push(h(ordered ? 'ol' : 'ul', { key: nextKey(), style: ordered ? styles.mdOl : styles.mdUl }, items));
      continue;
    }
    // Paragraph — gather consecutive lines until a blank line or another block.
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^\s*```/.test(lines[i]) &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^\s*>/.test(lines[i]) &&
      !/^(\s*)([-*+]|\d+\.)\s+/.test(lines[i]) &&
      !/^\s*([-*_])(\s*\1){2,}\s*$/.test(lines[i]) &&
      !(lines[i].includes('|') && i + 1 < lines.length && isTableSeparatorLine(lines[i + 1]))
    ) {
      para.push(lines[i]);
      i++;
    }
    const pk = nextKey();
    const inlineNodes: ComponentChildren[] = [];
    para.forEach((pl, idx) => {
      if (idx > 0) inlineNodes.push(<br key={`${pk}-br-${idx}`} />);
      inlineNodes.push(...parseInline(pl, `${pk}-${idx}`));
    });
    blocks.push(
      <p key={pk} style={styles.mdP}>
        {inlineNodes}
      </p>,
    );
  }
  return blocks;
}

// A fenced code block with a copy-to-clipboard icon that appears on hover.
// The icon nudges down and to the right on press (same faked-`:active` trick
// as the bottom-bar FooterButton) and briefly swaps to a checkmark once the
// text has actually been copied.
function CodeBlock({ code }: { code: string }) {
  const [hover, setHover] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [copied, setCopied] = useState(false);
  const press = () => setPressed(true);
  const release = () => setPressed(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };
  return (
    <div style={styles.mdPreWrap} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <pre style={styles.mdPre}>
        <code>{code}</code>
      </pre>
      {hover && (
        <button
          style={styles.mdCopyBtn}
          title={copied ? 'Copied!' : 'Copy'}
          onClick={handleCopy}
          onMouseDown={press}
          onMouseUp={release}
          onMouseLeave={release}
          onTouchStart={press}
          onTouchEnd={release}
          onTouchCancel={release}
        >
          <span style={pressed ? styles.footerBtnSymbolPressed : styles.footerBtnSymbol}>
            {copied ? '✓' : '⧉'}
          </span>
        </button>
      )}
    </div>
  );
}

function KodoBlock({ variant, inner }: { variant: KodoVariant; inner: string }) {
  const meta = KODO_META[variant];
  return (
    <div style={meta.block}>
      <span style={meta.icon}>{meta.symbol}</span>
      <div style={styles.kodoBody}>{parseBlocks(inner.trim(), 'kodo')}</div>
    </div>
  );
}

// Split top-level content into kodo callout blocks and plain markdown spans,
// then render each. An unterminated kodo tag consumes the rest of the text.
function renderContent(text: string): ComponentChildren[] {
  const out: ComponentChildren[] = [];
  let rest = text;
  let key = 0;
  while (rest.length > 0) {
    const m = KODO_OPEN_RE.exec(rest);
    if (!m) {
      out.push(...parseBlocks(rest, `md-${key++}`));
      break;
    }
    const before = rest.slice(0, m.index);
    if (before.trim() !== '') out.push(...parseBlocks(before, `md-${key++}`));
    const variant = m[1] as KodoVariant;
    const afterOpen = rest.slice(m.index + m[0].length);
    const cm = new RegExp(`</${variant}>`).exec(afterOpen);
    let inner: string;
    if (cm) {
      inner = afterOpen.slice(0, cm.index);
      rest = afterOpen.slice(cm.index + cm[0].length);
    } else {
      inner = afterOpen; // unclosed → take the remainder of the text
      rest = '';
    }
    out.push(<KodoBlock key={`kodo-${key++}`} variant={variant} inner={inner} />);
  }
  return out;
}

export function Markdown({ content }: { content: string }) {
  return <div style={styles.mdRoot}>{renderContent(content)}</div>;
}
