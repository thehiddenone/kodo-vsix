/**
 * Kōdo Settings webview entry point — esbuild bundles from here into
 * `dist/settings-webview.js` (+ a sibling `dist/settings-webview.css`
 * extracted from the `./styles.css` import below). See `../esbuild.js` and
 * `../settings-panel/panel.ts` (the host side that loads this bundle).
 */

import { render } from 'preact';
import { App } from './App';
import './styles.css';

const root = document.getElementById('root');
if (root !== null) {
  render(<App />, root);
}
