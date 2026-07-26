import { vscode } from './vscode';

export function LlamaOverrideSection({ llamaServerOverridePath }: { llamaServerOverridePath: string | null }) {
  return (
    <div>
      <div className="section-subheading">Llama-server binary override</div>
      <p className="explain">
        You can build and manage your own installation of llama.cpp instead of using the bundled binary — this
        can be especially useful on Linux, where you may want to build a custom llama.cpp with CUDA support.
      </p>
      <div id="override-path">
        {llamaServerOverridePath || 'No override — using the bundled llama.cpp binary.'}
      </div>
      <div className="spacer" />
      <p className="explain">Point Kōdo at a llama-server binary from your own llama.cpp build.</p>
      <button className="action-btn" onClick={() => vscode.postMessage({ type: 'set_override' })}>
        Set llama.cpp override
      </button>
      <div className="spacer" />
      <p className="explain">Clear the override and go back to the bundled llama.cpp binary.</p>
      <button
        className="action-btn"
        disabled={!llamaServerOverridePath}
        onClick={() => {
          if (!llamaServerOverridePath) { return; }
          vscode.postMessage({ type: 'remove_override' });
        }}
      >
        Remove llama.cpp override
      </button>
    </div>
  );
}
