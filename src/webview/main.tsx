/**
 * Kōdo WebView entry point.
 *
 * The UI was split out of this file into focused modules (see ./App and the
 * per-component files alongside it). This entry only wires the root component
 * into the DOM; esbuild bundles from here (see esbuild.js).
 */

import { render } from 'preact';
import { App } from './App';

const root = document.getElementById('root');
if (root !== null) {
  render(<App />, root);
}
