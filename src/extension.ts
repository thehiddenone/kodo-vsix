import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
	const disposable = vscode.commands.registerCommand('kodo.open', () => {
		const panel = vscode.window.createWebviewPanel(
			'kodoConsole',
			'Kōdo',
			vscode.ViewColumn.One,
			{ enableScripts: true }
		);

		panel.webview.html = getWebviewContent();

		panel.webview.onDidReceiveMessage(
			message => {
				if (message.type === 'submit') {
					panel.webview.postMessage({ type: 'output', text: `> ${message.text}` });
				}
			},
			undefined,
			context.subscriptions
		);
	});

	context.subscriptions.push(disposable);
}

function getWebviewContent(): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    display: flex;
    flex-direction: column;
    height: 100vh;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: var(--vscode-editor-font-size, 13px);
    background: var(--vscode-editor-background);
    color: var(--vscode-editor-foreground);
  }
  #output {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
    white-space: pre-wrap;
    word-break: break-all;
  }
  #input-row {
    display: flex;
    border-top: 1px solid var(--vscode-panel-border);
    padding: 6px;
    gap: 6px;
  }
  #input {
    flex: 1;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
    padding: 4px 8px;
    font-family: inherit;
    font-size: inherit;
    resize: none;
    outline: none;
    border-radius: 2px;
    min-height: 28px;
    max-height: 120px;
  }
  #send {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    padding: 4px 12px;
    cursor: pointer;
    border-radius: 2px;
    font-size: inherit;
    align-self: flex-end;
  }
  #send:hover { background: var(--vscode-button-hoverBackground); }
</style>
</head>
<body>
<div id="output"></div>
<div id="input-row">
  <textarea id="input" rows="1" placeholder="Type a message..."></textarea>
  <button id="send">Send</button>
</div>
<script>
  const vscode = acquireVsCodeApi();
  const output = document.getElementById('output');
  const input = document.getElementById('input');
  const send = document.getElementById('send');

  function submit() {
    const text = input.value.trim();
    if (!text) return;
    vscode.postMessage({ type: 'submit', text });
    input.value = '';
    input.style.height = 'auto';
  }

  send.addEventListener('click', submit);

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  });

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = input.scrollHeight + 'px';
  });

  window.addEventListener('message', e => {
    const msg = e.data;
    if (msg.type === 'output') {
      const line = document.createElement('div');
      line.textContent = msg.text;
      output.appendChild(line);
      output.scrollTop = output.scrollHeight;
    }
  });
</script>
</body>
</html>`;
}

export function deactivate() {}
