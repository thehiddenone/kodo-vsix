// @ts-check
const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').Plugin} */
const problemMatcherPlugin = {
  name: 'esbuild-problem-matcher',
  setup(build) {
    build.onStart(() => console.log('[watch] build started'));
    build.onEnd((result) => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`);
        if (location) {
          console.error(`    ${location.file}:${location.line}:${location.column}`);
        }
      });
      console.log('[watch] build finished');
    });
  },
};

/** @type {import('esbuild').BuildOptions} */
const extensionOptions = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: /** @type {'cjs'} */ ('cjs'),
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  platform: /** @type {'node'} */ ('node'),
  outfile: 'dist/extension.js',
  external: ['vscode'],
  logLevel: 'silent',
  plugins: [problemMatcherPlugin],
};

/** @type {import('esbuild').BuildOptions} */
const webviewOptions = {
  entryPoints: ['src/webview/main.tsx'],
  bundle: true,
  format: /** @type {'iife'} */ ('iife'),
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  platform: /** @type {'browser'} */ ('browser'),
  outfile: 'dist/webview.js',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  logLevel: 'silent',
  plugins: [problemMatcherPlugin],
};

/** @type {import('esbuild').BuildOptions} */
const settingsWebviewOptions = {
  entryPoints: ['src/settings-webview/main.tsx'],
  bundle: true,
  format: /** @type {'iife'} */ ('iife'),
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  platform: /** @type {'browser'} */ ('browser'),
  outdir: 'dist',
  entryNames: 'settings-webview',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  logLevel: 'silent',
  plugins: [problemMatcherPlugin],
};

async function main() {
  if (watch) {
    const [extCtx, webCtx, settingsCtx] = await Promise.all([
      esbuild.context(extensionOptions),
      esbuild.context(webviewOptions),
      esbuild.context(settingsWebviewOptions),
    ]);
    await Promise.all([extCtx.watch(), webCtx.watch(), settingsCtx.watch()]);
  } else {
    await Promise.all([
      esbuild.build(extensionOptions),
      esbuild.build(webviewOptions),
      esbuild.build(settingsWebviewOptions),
    ]);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
