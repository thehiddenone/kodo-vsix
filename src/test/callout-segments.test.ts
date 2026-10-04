import * as assert from 'assert';

import { splitCallouts } from '../webview/calloutSegments';

// The WebView markdown renderer's callout splitting: `<kodo…>` tags are
// callouts in prose, but plain code inside a ``` fenced block or a `…` span.
suite('splitCallouts', () => {
  test('splits prose and a closed callout', () => {
    assert.deepStrictEqual(splitCallouts('Done. <kodo>All tests pass.</kodo> Next.'), [
      { kind: 'markdown', text: 'Done. ' },
      { kind: 'callout', variant: 'kodo', inner: 'All tests pass.' },
      { kind: 'markdown', text: ' Next.' },
    ]);
  });

  test('a specific variant is never read as <kodo>', () => {
    assert.deepStrictEqual(splitCallouts('<kodo_warn>careful</kodo_warn>'), [
      { kind: 'callout', variant: 'kodo_warn', inner: 'careful' },
    ]);
  });

  test('an unclosed callout consumes the rest of the text', () => {
    assert.deepStrictEqual(splitCallouts('a <kodo_info>still streaming'), [
      { kind: 'markdown', text: 'a ' },
      { kind: 'callout', variant: 'kodo_info', inner: 'still streaming' },
    ]);
  });

  test('tags inside a fenced code block stay code', () => {
    const text = [
      'Example:',
      '```html',
      '<kodo>good</kodo>',
      '<kodo_crit>bad</kodo_crit>',
      '<kodo_info>unclosed',
      '```',
      'after',
    ].join('\n');

    assert.deepStrictEqual(splitCallouts(text), [{ kind: 'markdown', text }]);
  });

  test('tags inside an unterminated (still streaming) fence stay code', () => {
    const text = 'Example:\n```\n<kodo>good</kodo>';

    assert.deepStrictEqual(splitCallouts(text), [{ kind: 'markdown', text }]);
  });

  test('a callout after a closed fence is still a callout', () => {
    const fence = '```\n<kodo>code</kodo>\n```\n';

    assert.deepStrictEqual(splitCallouts(`${fence}<kodo>real</kodo>`), [
      { kind: 'markdown', text: fence },
      { kind: 'callout', variant: 'kodo', inner: 'real' },
    ]);
  });

  test('a closing tag inside a fence within a callout does not end the callout', () => {
    const inner = '\nUse:\n```\nprint("</kodo>")\n```\n';

    assert.deepStrictEqual(splitCallouts(`<kodo>${inner}</kodo>tail`), [
      { kind: 'callout', variant: 'kodo', inner },
      { kind: 'markdown', text: 'tail' },
    ]);
  });

  test('tags inside inline code spans stay code', () => {
    const text = 'Wrap good news in `<kodo>` … `</kodo>`, errors in `<kodo_crit>`.';

    assert.deepStrictEqual(splitCallouts(text), [{ kind: 'markdown', text }]);
  });

  test('a callout on the same line as an inline code span is still a callout', () => {
    assert.deepStrictEqual(splitCallouts('Use `<kodo>` like this: <kodo>done</kodo>'), [
      { kind: 'markdown', text: 'Use `<kodo>` like this: ' },
      { kind: 'callout', variant: 'kodo', inner: 'done' },
    ]);
  });

  test('a closing tag inside an inline code span does not end the callout', () => {
    assert.deepStrictEqual(splitCallouts('<kodo>Close with `</kodo>`.</kodo>tail'), [
      { kind: 'callout', variant: 'kodo', inner: 'Close with `</kodo>`.' },
      { kind: 'markdown', text: 'tail' },
    ]);
  });

  test('an unpaired backtick does not hide a tag', () => {
    assert.deepStrictEqual(splitCallouts('a ` b <kodo>c</kodo>'), [
      { kind: 'markdown', text: 'a ` b ' },
      { kind: 'callout', variant: 'kodo', inner: 'c' },
    ]);
  });

  test('an inline code span does not continue across a line break', () => {
    assert.deepStrictEqual(splitCallouts('a `b\n<kodo>c</kodo> d`'), [
      { kind: 'markdown', text: 'a `b\n' },
      { kind: 'callout', variant: 'kodo', inner: 'c' },
      { kind: 'markdown', text: ' d`' },
    ]);
  });

  test('a closing tag right after a closing fence ends both the code block and the callout', () => {
    const text = '<kodo>Fixed it:\n```py\nx = 1\n```</kodo>\nAll good otherwise.';

    assert.deepStrictEqual(splitCallouts(text), [
      { kind: 'callout', variant: 'kodo', inner: 'Fixed it:\n```py\nx = 1\n```' },
      { kind: 'markdown', text: '\nAll good otherwise.' },
    ]);
  });

  test('a callout can start right after a closing fence on the same line', () => {
    const text = 'Here:\n```\ncode\n``` <kodo>done</kodo>\nMore text.';

    assert.deepStrictEqual(splitCallouts(text), [
      { kind: 'markdown', text: 'Here:\n```\ncode\n``` ' },
      { kind: 'callout', variant: 'kodo', inner: 'done' },
      { kind: 'markdown', text: '\nMore text.' },
    ]);
  });

  test('inline code after a fence-closing tag line stays code', () => {
    const text = '<kodo>a\n```\nx\n```</kodo> see `<kodo>` here';

    assert.deepStrictEqual(splitCallouts(text), [
      { kind: 'callout', variant: 'kodo', inner: 'a\n```\nx\n```' },
      { kind: 'markdown', text: ' see `<kodo>` here' },
    ]);
  });

  test('a closing fence followed by prose still does not close the fence', () => {
    const text = '```\ncode\n``` and then <kodo>x</kodo>';

    assert.deepStrictEqual(splitCallouts(text), [{ kind: 'markdown', text }]);
  });
});
