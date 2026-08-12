import { llamaCppIsUpToDate } from './localLlmUtils';
import type { LlamaCppInfo } from './types';
import { vscode } from './vscode';

const LLAMACPP_RELEASES_URL = 'https://github.com/ggml-org/llama.cpp/releases';

export function LlamaCppSection({ llamaCpp }: { llamaCpp: LlamaCppInfo }) {
  const installed = Boolean(llamaCpp.installedVersion);
  const busy = llamaCpp.busy;
  // Already on (or ahead of) the latest build: the server would answer
  // `llamacpp.update` with a single "already up to date" frame and change
  // nothing, so offering the button only invites a click that appears to do
  // nothing. Disabled rather than hidden, so the control stays where the user
  // expects it and the tooltip can say why. Deliberately *not* a substitute
  // for the server-side short-circuit — this is the same judgement made from
  // the panel's cached version info, which is stale between refreshes.
  const upToDate = installed && llamaCppIsUpToDate(llamaCpp.installedVersion, llamaCpp.latestVersion);
  return (
    <div>
      <div className="section-subheading">Llama.cpp</div>
      <p className="intro-text">
        llama.cpp is the local inference engine Kōdo uses to run models on this machine. Install, update, or
        remove it here, and see how the installed build compares to the latest one published on GitHub.
      </p>
      <p className="value-line">
        Installed version: <span className="value-code">{llamaCpp.installedVersion || 'not installed yet'}</span>
      </p>
      <p className="value-line">
        Latest version available at GitHub:{' '}
        {llamaCpp.latestVersion ? (
          <a href={LLAMACPP_RELEASES_URL} className="value-code">{llamaCpp.latestVersion}</a>
        ) : (
          <span className="value-code">unknown</span>
        )}
      </p>
      {upToDate && (
        <p className="value-line">llama.cpp is up to date — there is nothing newer to install.</p>
      )}
      <div className="btn-row">
        <button
          disabled={busy || upToDate}
          title={upToDate ? `llama.cpp ${llamaCpp.installedVersion} is already the latest build.` : undefined}
          onClick={() => vscode.postMessage({ type: installed ? 'update_llamacpp' : 'install_llamacpp' })}
        >
          {installed ? 'Update llama.cpp' : 'Install llama.cpp'}
        </button>
        <span className="btn-separator" />
        <button
          className="secondary-btn"
          disabled={busy}
          onClick={() => vscode.postMessage({ type: 'install_llamacpp_version_prompt' })}
        >
          Install specific version…
        </button>
        {installed && (
          <>
            <span className="btn-separator" />
            <button
              className="secondary-btn"
              disabled={busy}
              onClick={() => vscode.postMessage({ type: 'uninstall_llamacpp' })}
            >
              Uninstall llama.cpp
            </button>
          </>
        )}
      </div>
    </div>
  );
}
