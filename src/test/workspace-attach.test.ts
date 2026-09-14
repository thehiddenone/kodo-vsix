import * as assert from 'assert';

import {
  FOLDER_CHANGE_TIMEOUT_MS,
  SERVER_ATTACH_TIMEOUT_MS,
  attachResponsePayload,
} from '../extension/workspace-attach';
import { reloadWipesSerializerState } from '../reconcile-policy';

// The `workspace.confirm_folder` round-trip (WS_PROTOCOL.md §6.11) is what
// keeps the server's `scaffold_new_project` from returning to the agent while
// VS Code is mid window-reload. Its moving parts mostly need a live window, but
// the two things that are a *contract* — the response payload the server parses
// and the relationship between the two ends' deadlines — are pure, and are
// exactly the parts a future edit is liable to break silently.
suite('workspace-attach', () => {
  suite('attachResponsePayload', () => {
    test('a successful attach carries no error key at all', () => {
      // Not `error: ''` — the server tests truthiness, and an empty-string
      // error would still read as "present" to a stricter future check.
      assert.deepStrictEqual(attachResponsePayload({ attached: true, reloaded: false }), {
        attached: true,
        reloaded: false,
      });
    });

    test('reloaded is reported so the server log can explain a slow tool call', () => {
      assert.deepStrictEqual(attachResponsePayload({ attached: true, reloaded: true }), {
        attached: true,
        reloaded: true,
      });
    });

    test('a failure carries the reason through to the agent-facing warning', () => {
      assert.deepStrictEqual(
        attachResponsePayload({
          attached: false,
          reloaded: false,
          error: 'VS Code rejected the workspace-folder change',
        }),
        {
          attached: false,
          reloaded: false,
          error: 'VS Code rejected the workspace-folder change',
        },
      );
    });
  });

  suite('timeouts', () => {
    test('this side gives up before the server does', () => {
      // The client knows *what* VS Code did and can name the failure; the
      // server can only report a bare "timeout". Losing this ordering silently
      // downgrades every failure message.
      assert.ok(
        FOLDER_CHANGE_TIMEOUT_MS < SERVER_ATTACH_TIMEOUT_MS,
        `client timeout ${FOLDER_CHANGE_TIMEOUT_MS}ms must stay under the server's ` +
          `${SERVER_ATTACH_TIMEOUT_MS}ms (EngineCore.WORKSPACE_ATTACH_TIMEOUT_S)`,
      );
    });

    test('the gap is wide enough to actually deliver the reply', () => {
      assert.ok(SERVER_ATTACH_TIMEOUT_MS - FOLDER_CHANGE_TIMEOUT_MS >= 5_000);
    });
  });

  suite('reload prediction', () => {
    test('the transitions that restart the extension host are the ones we arm for', () => {
      // `confirmWorkspaceFolder` arms window-id continuity, the dead-serializer
      // marker and the `reloaded` marker off this same predicate, and relies on
      // the pre-reload host simply never answering. If this ever stopped being
      // true for index 0/1, those markers would go unarmed and the reloaded
      // window would lose its session instead of answering the replayed request.
      assert.strictEqual(reloadWipesSerializerState(0), true);
      assert.strictEqual(reloadWipesSerializerState(1), true);
      assert.strictEqual(reloadWipesSerializerState(2), false);
    });
  });
});
