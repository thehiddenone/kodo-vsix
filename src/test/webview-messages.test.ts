import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

// Every host -> webview message must be handled by App.tsx's `onMessage`
// switch. That switch has no `default:` branch, so a message type nobody wrote
// a `case` for is dropped in silence: the extension host posts it, the reducer
// has a matching action, the reducer's own unit tests pass, and the feature is
// simply invisible at runtime. Three shipped features had exactly that hole
// (`plan_state`, `review_findings` and `plan_conflict_critical` rendered only
// after a window reload, when `session_history` replays the server's markers
// through a different path; `file_review_cleared` never closed the panel).
//
// This scans the source rather than the compiled bundle because the wiring is
// what it checks: the two ends are connected by a string literal, and nothing
// in the type system relates them.
suite('webview messages — every posted type has a case in App.tsx', () => {
  const root = path.resolve(__dirname, '..', '..');

  function readSources(dir: string): { file: string; text: string }[] {
    const out: { file: string; text: string }[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(...readSources(full));
      } else if (entry.name.endsWith('.ts')) {
        out.push({ file: path.relative(root, full), text: fs.readFileSync(full, 'utf8') });
      }
    }
    return out;
  }

  // `post({ type: 'x'` / `this.post({ type: 'x'` is the one way the host talks
  // to the webview (SessionController hands every module the same posting
  // function), so matching the call shape finds them all.
  const POSTED = /\bpost\(\s*\{\s*type:\s*'([a-zA-Z_]+)'/g;

  test('the scan finds the posting sites at all', () => {
    assert.ok(posted().size > 20, 'the post() call shape changed — this test now checks nothing');
  });

  function posted(): Map<string, string> {
    const found = new Map<string, string>();
    for (const dir of ['src/session', 'src/extension']) {
      for (const source of readSources(path.join(root, dir))) {
        for (const match of source.text.matchAll(POSTED)) {
          if (!found.has(match[1])) {
            found.set(match[1], source.file);
          }
        }
      }
    }
    return found;
  }

  test('App.tsx handles every message the extension host posts', () => {
    const app = fs.readFileSync(path.join(root, 'src/webview/App.tsx'), 'utf8');
    const handled = new Set(Array.from(app.matchAll(/case '([a-zA-Z_]+)':/g), (m) => m[1]));
    const missing = Array.from(posted().entries())
      .filter(([type]) => !handled.has(type))
      .map(([type, file]) => `${type} (posted by ${file})`);
    assert.deepStrictEqual(missing, [], `App.tsx drops these messages: ${missing.join(', ')}`);
  });
});
