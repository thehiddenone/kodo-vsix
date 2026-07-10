# Kōdo — VS Code Extension

The VS Code front-end for [Kōdo](../kodo): a build system that converts natural language into working code through a multi-agent LLM workflow, designed to run on your own hardware — model included.

This README covers installing and running the extension. Everything else — the workflow, the agents, the wire protocol, security, local inference — is documented in the Kōdo repo: start with [`kodo/README.md`](https://github.com/thehiddenone/kodo/blob/main/README.md) and [`kodo/doc/`](https://github.com/thehiddenone/kodo/tree/main/doc).

## Running Kōdo

There is no packaged `.vsix` yet. The way to run Kōdo today is from source, in a VS Code Extension Development Host.

**Prerequisites:** Node.js 24 and a clone of both repos (`kodo` and `kodo-vsix`). You do **not** need Python installed — the extension provisions its own Python 3.12 environment on first run.

1. **Point `KODO_DEV_PATH` at the Kōdo Python package** — the directory of your `kodo` clone that contains `pyproject.toml`:

   ```bash
   export KODO_DEV_PATH=/path/to/kodo
   ```

   Until `kodo` is published on PyPI, the extension installs the server from this path (`uv pip install -e "$KODO_DEV_PATH"` — an editable install, so server-side Python changes take effect on the next server start without reinstalling).

   The variable must be visible to the VS Code **process**, not just your shell. The reliable way is to launch VS Code from a terminal that has it exported:

   ```bash
   export KODO_DEV_PATH=/path/to/kodo
   code /path/to/kodo-vsix
   ```

   On Windows (PowerShell): `$env:KODO_DEV_PATH = "C:\path\to\kodo"; code C:\path\to\kodo-vsix`. Setting it machine-wide (shell profile, System Environment Variables) also works.

2. **Install dependencies and launch:**

   ```bash
   cd /path/to/kodo-vsix
   npm install
   ```

   Open the `kodo-vsix` folder in VS Code and press **F5**. A second VS Code window opens — the Extension Development Host — with the extension loaded. Open any workspace folder in it and click the **Kōdo icon** in the activity bar (or run **Kōdo: Open Panel**).

3. **First activation** bootstraps everything automatically (this one-time setup takes a couple of minutes; a progress notification tracks it):
   - downloads `uv` into `~/.kodo/bin/`,
   - creates a Python 3.12 venv at `~/.kodo/venv/` (uv downloads the interpreter if needed),
   - installs the `kodo` package from `KODO_DEV_PATH` into that venv,
   - starts the Kōdo server and connects to it.

## One server, many windows

Every VS Code window runs its own copy of the extension, but there is exactly **one Kōdo server per machine** — a detached background process shared by all windows, so parallel sessions in different windows go through the same server and the same LLM gateway.

- On activation, the extension reads the discovery file `~/.kodo/kodo-server` (JSON `{"pid": …, "port": …}`). If a live server is advertised there, the window connects to it; only if the file is absent or stale does it spawn a new server (`python -m kodo.server`, WebSocket on `ws://127.0.0.1:<port>/ws`, default port 9042).
- The server deliberately survives window reloads and closes — it is spawned orphaned, so no window owns it. It shuts itself down ~30 seconds after the last window disconnects.
- You never need to kill it manually. If you want to force a restart (e.g. to pick up Kōdo Python changes), close all VS Code windows and wait half a minute, or kill the PID recorded in `~/.kodo/kodo-server`.

## Troubleshooting

### Where to look first

Every window has a **"Kodo Server"** output channel (View → Output) that live-tails the shared server log — startup errors, tracebacks, and the exact command line used to launch the server all appear there.

### Files Kōdo creates

Everything lives under `~/.kodo/`:

| Path | What it is |
| --- | --- |
| `kodo-server` | Discovery file: JSON `{"pid": …, "port": …}` written by the server on startup, removed on exit. The extension uses it to find the running server; a stale file (dead PID, free port) is deleted automatically. |
| `venv/` | Shared Python 3.12 venv holding the `kodo` package. **Safe to delete** — it is rebuilt on the next activation. |
| `bin/` | Bundled utilities (`uv`, `ripgrep`, `fd`), each in its own subdirectory with a `<name>.json` manifest pinning its version. |
| `logs/server.out.log` | Raw stdout/stderr of the server process, truncated on each new server launch. This is what the "Kodo Server" output channel tails. |
| `logs/server.log` | The server's structured log (rotates to `.1`/`.2`/`.3`). |
| `logs/llama-server.log` | Output of the local `llama-server` when a local model is loaded. |
| `logs/llm_requests/` | Per-request LLM payload dumps for debugging. |
| `etc/` | Server settings and the LLM registry (`settings.json`, `cloud_settings.json`, `local-llm-registry.json`, …). |
| `llama.cpp/` | Installed llama.cpp builds (`b<build>/`) and downloaded GGUF models (`models/`). |
| `sessions/` | Persisted sessions — every session survives crashes and window reloads and is resumable. |
| `websearch/` | The web-search agent's persistent pacing state. |

Cloud API keys are **not** in any of these files: they live in VS Code's encrypted secret storage and are handed to the server over the WebSocket at runtime, never via files or environment variables.

Per-project state (specs, checkpoint mirror, the `kodo.md` manifest) lives in a `.kodo/` directory inside each workspace, not under `~/.kodo/`.

### Common problems

**"KODO_DEV_PATH environment variable is not set"** — the extension could not install the server. Export the variable and make sure VS Code actually inherits it: launch `code` from a terminal where it is exported (a VS Code started from the dock/Start menu does not see your shell's exports).

**The server never comes up** — check the "Kodo Server" output channel. The extension already retries once with a freshly rebuilt venv before surfacing an error; if it is still stuck, delete `~/.kodo/venv/` yourself and reload the window. A corrupt or half-installed venv is the usual culprit.

**Server changes aren't picked up** — the venv install is editable, but a *running* server keeps its loaded code. Restart the server (see [One server, many windows](#one-server-many-windows)).

**Leftover `kodo-server` file after a crash or reboot** — harmless. The extension detects that the PID is dead and the port is free, removes the file, and starts a fresh server.

## Development

Targets: Node.js 24, Python 3.12 (server side), VS Code ≥ 1.90. The extension is TypeScript throughout, bundled with esbuild, linted with ESLint 9; the UI is Preact.

### Build and check

```bash
npm install            # dependencies
npm run check-types    # tsc --noEmit
npm run lint           # eslint src
npm run compile        # check-types + lint + esbuild dev build
npm run package        # same, with minified production bundles
npm run watch          # watch mode: esbuild + tsc in parallel
npm test               # integration tests via @vscode/test-cli
```

The build produces two independent bundles in `dist/`, one per JavaScript context:

| Bundle | Context | Entry point |
| --- | --- | --- |
| `extension.js` | Node.js (extension host), CommonJS | `src/extension.ts` |
| `webview.js` | Browser (Chromium WebView), IIFE, Preact JSX | `src/webview/main.tsx` |

### The F5 loop

Pressing **F5** runs the default build task — `watch:esbuild` and `watch:tsc` in the background — then launches the Extension Development Host. Edits rebuild automatically; run **Developer: Reload Window** in the dev-host window to load the rebuilt extension. Type errors surface in the Problems panel from the `tsc --watch` task even though esbuild (which does no type checking) keeps bundling.

Python-side changes need no rebuild at all — the server is installed editable from `KODO_DEV_PATH`; just restart the server.

### Source layout

| File | Responsibility |
| --- | --- |
| [extension.ts](src/extension.ts) | Activation: bootstraps the environment, launches/attaches to the server, routes protocol envelopes between server, sidebar, and panels. |
| [server-launcher.ts](src/server-launcher.ts) | Singleton discovery, detached server spawn (survives window reloads), shared-log tailing into the "Kodo Server" channel. |
| [uv-setup.ts](src/uv-setup.ts) | First-run bootstrap: install `uv`, create the venv, install `kodo` from `KODO_DEV_PATH`. |
| [ws-client.ts](src/ws-client.ts) | WebSocket client with automatic reconnect; the server replays buffered events on reconnect. |
| [envelope.ts](src/envelope.ts) | Wire-protocol envelope construction/parsing (see [`kodo/doc/WS_PROTOCOL.md`](../kodo/doc/WS_PROTOCOL.md)). |
| [session-controller.ts](src/session-controller.ts) | Per-session state and routing — one instance per session tab. |
| [sidebar-provider.ts](src/sidebar-provider.ts) | The activity-bar sidebar WebView. |
| [cloud-ai-settings-panel.ts](src/cloud-ai-settings-panel.ts), [cloud-credentials.ts](src/cloud-credentials.ts) | Cloud LLM settings UI; API keys in VS Code secret storage. |
| [local-inference-settings-panel.ts](src/local-inference-settings-panel.ts), [local-model-downloads.ts](src/local-model-downloads.ts) | Local model management UI and download-progress polling. |
| [llm-registry-types.ts](src/llm-registry-types.ts) | Types shared with the server's LLM registry. |
| [src/webview/](src/webview/) | The Preact session UI: streaming agent output, approval gates, permission prompts, usage panel ([main.tsx](src/webview/main.tsx) is the entry point). |

The extension host and the WebView are separate JavaScript worlds: the WebView talks only `postMessage` to the extension host, which bridges to the server's WebSocket. The wire protocol — JSON envelopes carrying requests, responses, events, and token streams — is specified in [`kodo/doc/WS_PROTOCOL.md`](https://github.com/thehiddenone/kodo/blob/main/doc/WS_PROTOCOL.md); the overall design map is [`kodo/doc/INTERNALS.md`](https://github.com/thehiddenone/kodo/blob/main/doc/INTERNALS.md).
