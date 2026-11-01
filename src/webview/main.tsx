/**
 * Kōdo WebView entry point.
 *
 * The UI was split out of this file into focused modules (see ./App and the
 * per-component files alongside it). This entry only wires the root component
 * into the DOM; esbuild bundles from here (see esbuild.js).
 */

import { render } from 'preact';
import { App } from './App';
import { vscode } from './vscode';

// Tell the host the user is working in this session now. Clicking into a tab
// that is already active in its group, or into the docked side-bar view,
// changes no VS Code view state, so this is the host's only signal for it
// (`SessionHost.onActivated`, src/session/session-host.ts).
window.addEventListener('focus', () => vscode.postMessage({ type: 'focused' }));

const root = document.getElementById('root');
if (root !== null) {
  render(<App />, root);
}
