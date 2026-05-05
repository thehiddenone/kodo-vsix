# Kodo — VS Code Extension

The VS Code front-end for [Kodo](../kodo): a build system that converts natural-language requirements into working code through a multi-agent LLM workflow.

## What this extension does

- Launches and manages the **Kodo server** subprocess for the open workspace.
- Provides a **WebView panel** ("Kodo: Open Panel") that shows the live agent conversation, file events, approval prompts, and token-level LLM output as it streams.
- Forwards **Dev decisions** (Agree / Provide Feedback) back to the server via the wire protocol.
- Exposes a **STOP control** that cancels all in-flight agent work within one second.

## How it interacts with the Kodo server

The extension and server are two separate processes that communicate over a local WebSocket connection.

```text
VS Code extension host (Node.js)          Kodo server (Python / asyncio)
  ServerLauncher                            ws://127.0.0.1:9042/ws
    └─ spawns ──────────────────────────►  kodo-server --project <root>
  WsClient
    └─ connects ◄──────────────────────►  WebSocket endpoint
  extension.ts
    └─ routes envelopes ◄───────────────  agent.tokens, approval.request,
                                           file.change, state, usage.update …
  WebviewPanel
    └─ renders ──────────────────────────► Preact UI (dist/webview.js)
       postMessage ◄─────────────────────  extension host bridges the gap
```

**Startup sequence:**

1. Extension activates → `ServerLauncher` spawns `python -m kodo.server --project <workspace-root>`.
2. After a short delay (server bind time), `WsClient` opens `ws://127.0.0.1:9042/ws`.
3. On connect, the extension sends a `hello` request; the server replies with its version and last-session info, then emits an initial `state` event.
4. When "Kodo: Open Panel" is run, the WebView is created and starts receiving forwarded envelopes from the extension host.

**Wire protocol** — every frame is a JSON envelope:

```json
{ "kind": "request|response|event|stream_chunk|stream_end",
  "id": "<hex-uuid>",
  "correlation_id": "<id of originating request>",
  "payload": { "type": "<message-type>", ...fields } }
```

The extension sends `request` frames (`hello`, `ping`, `approval.respond`, `stop`) and receives `response`, `event`, and `stream_chunk`/`stream_end` frames from the server. If the WebSocket drops, `WsClient` reconnects automatically; the server buffers outbound frames in an in-memory outbox and replays them on reconnect.

## Commands

| Command | Description |
| --- | --- |
| `Kodo: Open Panel` | Open (or reveal) the Kodo WebView panel |
| `Kodo: Init Project` | Scaffold `kodo.md`, `src/`, `gen/`, `.kodo/` in the workspace root *(M2)* |

## Development

Requires [mise](https://mise.jdx.dev/) with the versions declared in `mise.toml` (Node 24, Python 3.12).

```bash
# Install dependencies
npm install

# Type-check
npm run check-types

# Build (extension + webview bundles)
npm run compile
```

Press **F5** inside VS Code (with `kodo-vsix` as the workspace root) to launch an Extension Development Host — a second VS Code window with the extension loaded. The pre-launch task runs `watch:esbuild` and `watch:tsc` in the background so edits rebuild automatically.

The build produces two bundles in `dist/`:

| File | Context | Entry point |
| --- | --- | --- |
| `extension.js` | Node.js (extension host) | `src/extension.ts` |
| `webview.js` | Browser (Chromium WebView) | `src/webview/main.tsx` |
