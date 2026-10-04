import * as assert from 'assert';

import { Markdown } from '../webview/markdown';

// What the WebView's Markdown renderer puts where: the text, inline code and
// code blocks at one level, and the callout boxes nested in it. No DOM is
// needed — the rendered preact tree is walked directly. A code block is read
// off its `code` prop rather than rendered (it holds hover/copy state, which
// needs a live preact render), and a callout box is rendered by calling it.
interface Scope {
  text: string[];
  inlineCode: string[];
  codeBlocks: string[];
  callouts: { variant: string; content: Scope }[];
}

function emptyScope(): Scope {
  return { text: [], inlineCode: [], codeBlocks: [], callouts: [] };
}

function textOf(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') {
    return '';
  }
  if (Array.isArray(node)) {
    return node.map(textOf).join('');
  }
  if (typeof node === 'object') {
    return textOf((node as { props: { children?: unknown } }).props.children);
  }
  return String(node);
}

function collect(node: unknown, scope: Scope): void {
  if (node === null || node === undefined || typeof node === 'boolean') {
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((n) => collect(n, scope));
    return;
  }
  if (typeof node !== 'object') {
    const text = String(node).trim();
    if (text !== '') {
      scope.text.push(text);
    }
    return;
  }
  const { type, props } = node as { type: unknown; props: Record<string, unknown> };
  if (typeof type === 'function') {
    if ('code' in props) {
      scope.codeBlocks.push(String(props.code));
    } else if ('variant' in props) {
      const content = emptyScope();
      collect((type as (p: unknown) => unknown)(props), content);
      scope.callouts.push({ variant: String(props.variant), content });
    } else {
      collect((type as (p: unknown) => unknown)(props), scope);
    }
    return;
  }
  if (type === 'code') {
    scope.inlineCode.push(textOf(props.children));
    return;
  }
  collect(props.children, scope);
}

function render(content: string): Scope {
  const scope = emptyScope();
  collect(Markdown({ content }), scope);
  return scope;
}

// A callout box's content, minus its leading icon.
function box(variant: string, icon: string, content: Partial<Scope>): Scope['callouts'][number] {
  const full = { ...emptyScope(), ...content };
  return { variant, content: { ...full, text: [icon, ...full.text] } };
}

suite('Markdown — callouts and code', () => {
  test('a closing tag right after a closing fence: the code block renders inside the callout', () => {
    const out = render('<kodo>Fixed it:\n```py\nx = 1\n```</kodo>\nAll good otherwise.');

    assert.deepStrictEqual(out, {
      ...emptyScope(),
      text: ['All good otherwise.'],
      callouts: [box('kodo', 'ド', { text: ['Fixed it:'], codeBlocks: ['x = 1'] })],
    });
  });

  test('a closing tag on its own line after the fence renders the same', () => {
    const out = render('<kodo>Fixed it:\n```py\nx = 1\n```\n</kodo>\nAll good otherwise.');

    assert.deepStrictEqual(out, {
      ...emptyScope(),
      text: ['All good otherwise.'],
      callouts: [box('kodo', 'ド', { text: ['Fixed it:'], codeBlocks: ['x = 1'] })],
    });
  });

  test('a callout right after a closing fence on the same line renders after the code block', () => {
    const out = render('Here:\n```\ncode\n``` <kodo_info>done</kodo_info>\nMore text.');

    assert.deepStrictEqual(out, {
      ...emptyScope(),
      text: ['Here:', 'More text.'],
      codeBlocks: ['code'],
      callouts: [box('kodo_info', 'ℹ️', { text: ['done'] })],
    });
  });

  test('a stray closing tag after a closing fence closes the code block and shows as text', () => {
    const out = render('```\ncode\n```</kodo>\nmore');

    assert.deepStrictEqual(out, {
      ...emptyScope(),
      text: ['</kodo>', 'more'],
      codeBlocks: ['code'],
    });
  });

  test('tags inside a fenced code block render as code, not callouts', () => {
    const code = '<kodo>good</kodo>\n<kodo_crit>bad</kodo_crit>\n<kodo_warn>unclosed';
    const out = render(`Example:\n\`\`\`html\n${code}\n\`\`\`\nafter`);

    assert.deepStrictEqual(out, { ...emptyScope(), text: ['Example:', 'after'], codeBlocks: [code] });
  });

  test('tags inside a still-streaming code block render as code', () => {
    const out = render('Example:\n```\n<kodo>good</kodo>');

    assert.deepStrictEqual(out, {
      ...emptyScope(),
      text: ['Example:'],
      codeBlocks: ['<kodo>good</kodo>'],
    });
  });

  test('a closing tag inside a code block within a callout stays code', () => {
    const out = render('<kodo>Use:\n```\nprint("</kodo>")\n```\n</kodo>tail');

    assert.deepStrictEqual(out, {
      ...emptyScope(),
      text: ['tail'],
      callouts: [box('kodo', 'ド', { text: ['Use:'], codeBlocks: ['print("</kodo>")'] })],
    });
  });

  test('tags inside inline code render as inline code, not callouts', () => {
    const out = render('Wrap good news in `<kodo>` … `</kodo>`.');

    assert.deepStrictEqual(out, {
      ...emptyScope(),
      text: ['Wrap good news in', '…', '.'],
      inlineCode: ['<kodo>', '</kodo>'],
    });
  });

  test('a closing tag inside inline code within a callout stays inline code', () => {
    const out = render('<kodo_warn>Close with `</kodo_warn>`.</kodo_warn>tail');

    assert.deepStrictEqual(out, {
      ...emptyScope(),
      text: ['tail'],
      callouts: [box('kodo_warn', '⚠️', { text: ['Close with', '.'], inlineCode: ['</kodo_warn>'] })],
    });
  });

  test('prose after a closing fence does not close it, so the rest is code', () => {
    const out = render('```\ncode\n``` and then <kodo>x</kodo>');

    assert.deepStrictEqual(out, {
      ...emptyScope(),
      codeBlocks: ['code\n``` and then <kodo>x</kodo>'],
    });
  });

  test('a still-streaming callout renders its content inside the box', () => {
    const out = render('Note: <kodo_crit>build failed\n```\nerror: x');

    assert.deepStrictEqual(out, {
      ...emptyScope(),
      text: ['Note:'],
      callouts: [box('kodo_crit', '💥', { text: ['build failed'], codeBlocks: ['error: x'] })],
    });
  });
});
