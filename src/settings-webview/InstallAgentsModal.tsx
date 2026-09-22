import { useEffect, useRef, useState } from 'preact/hooks';
import type { AgentInstallResult, AgentScanResult } from './types';
import { vscode } from './vscode';

interface InstallAgentsModalProps {
  /** A source to open with already filled in — set when the user picked a
   * local folder, so the same modal serves both entry points and the
   * keep-or-replace step is never skipped just because the source was local. */
  initialSource?: string;
  /** Latest `agents.install_scan` reply pushed into panel state, or `null`
   * before the first one. Compared against `submittedSource` below so a reply
   * left over from an earlier, already-closed instance of this modal is never
   * mistaken for one answering the current request. */
  scan: AgentScanResult | null;
  /** Latest `agents.install` reply, same staleness guard as `scan`. */
  install: AgentInstallResult | null;
  onClose: () => void;
}

type Step = 'source' | 'review' | 'installing' | 'result';

/** "Install agents" — the source → review → results flow
 * (kodo/doc/USER_AGENTS.md §4, kodo/doc/WS_PROTOCOL.md §7.6l).
 *
 * The review step is where this differs from the skills modal, and why it is a
 * separate component rather than a parameterisation of it: the decision is not
 * *which* entries to install but whether to **keep or replace** what is already
 * installed, answered once for the whole source after seeing both versions side
 * by side. The comparison itself is rendered by the server
 * (`SourceScan.conflict_report`), so the panel and the CLI ask the question with
 * the same words.
 *
 * A fresh mount starts with an empty `submittedSource`, which keeps a
 * `scan`/`install` prop still holding a previous instance's result from being
 * read as an answer to a request this instance never made. */
export function InstallAgentsModal({
  initialSource,
  scan,
  install,
  onClose,
}: InstallAgentsModalProps) {
  const [source, setSource] = useState(initialSource ?? '');
  const [step, setStep] = useState<Step>('source');
  const [scanning, setScanning] = useState(false);
  const [submittedSource, setSubmittedSource] = useState('');
  const sourceRef = useRef<HTMLInputElement>(null);
  useEffect(() => sourceRef.current?.focus(), []);

  useEffect(() => {
    if (!scanning || !scan || scan.source !== submittedSource) {
      return;
    }
    setScanning(false);
    if (scan.ok && scan.candidates.length > 0) {
      setStep('review');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scan]);

  useEffect(() => {
    if (step !== 'installing' || !install || install.source !== submittedSource) {
      return;
    }
    setStep('result');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [install]);

  function submitScan() {
    const trimmed = source.trim();
    if (!trimmed || scanning) {
      return;
    }
    setSubmittedSource(trimmed);
    setScanning(true);
    vscode.postMessage({ type: 'scan_agent_source', source: trimmed });
  }

  function submitInstall(replace: boolean) {
    setStep('installing');
    vscode.postMessage({ type: 'install_agents', source: submittedSource, replace });
  }

  const answered = scan !== null && scan.source === submittedSource && !scanning;
  const foundNothing = answered && scan!.ok && scan!.candidates.length === 0;
  const failed = answered && !scan!.ok;
  const installable = scan?.candidates.filter((c) => c.error === '') ?? [];
  const hasConflicts = (scan?.conflicts ?? '') !== '';

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="modal-box"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <h3>Install agents</h3>

        {step === 'source' && (
          <>
            <p className="modal-intro">
              Give a local folder or a git repository URL. Either way it holds{' '}
              <span className="value-code">&lt;name&gt;.json</span> and{' '}
              <span className="value-code">agent_&lt;name&gt;.md</span> at its root, and any
              sub-agents under <span className="value-code">subagents/&lt;name&gt;/</span>. Kōdo reads it and
              shows you what it would install before writing anything.
            </p>
            <div className="modal-field">
              <label for="agent-source">Folder or repository URL</label>
              <input
                ref={sourceRef}
                type="text"
                id="agent-source"
                autocomplete="off"
                placeholder="https://github.com/owner/repo"
                value={source}
                onInput={(e) => setSource((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    submitScan();
                  }
                }}
                disabled={scanning}
              />
              {failed && <div className="field-error">{scan!.error}</div>}
              {foundNothing && (
                <div className="field-error">No agents were found in this source.</div>
              )}
            </div>
            <div className="modal-actions">
              <button className="secondary-btn" onClick={onClose}>
                Cancel
              </button>
              <button onClick={submitScan} disabled={scanning || !source.trim()}>
                {scanning ? 'Reading…' : 'Read'}
              </button>
            </div>
          </>
        )}

        {step === 'review' && scan && scan.ok && (
          <>
            <p className="modal-intro">
              Found {installable.length} agent{installable.length === 1 ? '' : 's'} in{' '}
              <span className="value-code">{submittedSource}</span>.
            </p>
            <div className="rule-table">
              {scan.candidates.map((c) => (
                <div className="skill-pick-row" key={`${c.kind}:${c.name}`}>
                  <div className="skill-pick-info">
                    <div className="skill-pick-name">
                      {c.kind} {c.name} {c.version}
                    </div>
                    {c.error !== '' ? (
                      <div className="skill-pick-conflict">Cannot be installed — {c.error}</div>
                    ) : c.installedVersion !== '' ? (
                      <div className="skill-pick-conflict">
                        Already installed at {c.installedVersion}.
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
            {hasConflicts && (
              <>
                <p className="modal-intro">Some of these are already installed:</p>
                <pre className="install-result-list">{scan.conflicts}</pre>
                <p className="modal-intro">
                  Keep the versions you have, or replace them with the ones from this source?
                </p>
              </>
            )}
            <div className="modal-actions">
              <button className="secondary-btn" onClick={onClose}>
                Cancel
              </button>
              {hasConflicts ? (
                <>
                  <button className="secondary-btn" onClick={() => submitInstall(false)}>
                    Keep installed
                  </button>
                  <button onClick={() => submitInstall(true)}>Replace</button>
                </>
              ) : (
                <button onClick={() => submitInstall(false)} disabled={installable.length === 0}>
                  Install{installable.length > 0 ? ` (${installable.length})` : ''}
                </button>
              )}
            </div>
          </>
        )}

        {step === 'installing' && <p className="modal-intro">Installing…</p>}

        {step === 'result' && install && (
          <>
            {install.ok ? (
              <>
                <p className="modal-intro">
                  {install.installed.length > 0
                    ? `Installed ${install.installed.length} agent${install.installed.length === 1 ? '' : 's'}:`
                    : 'Nothing was installed.'}
                </p>
                {install.installed.length > 0 && (
                  <ul className="install-result-list">
                    {install.installed.map((name) => (
                      <li key={name}>{name}</li>
                    ))}
                  </ul>
                )}
                {install.kept.length > 0 && (
                  <p className="field-error">
                    Kept the installed version of: {install.kept.join(', ')}
                  </p>
                )}
                {install.skipped.length > 0 && (
                  <p className="field-error">Skipped: {install.skipped.join('; ')}</p>
                )}
                {install.missing.length > 0 && (
                  <p className="field-error">
                    No longer found in the source: {install.missing.join(', ')}
                  </p>
                )}
              </>
            ) : (
              <p className="field-error">Could not install these agents — {install.error}</p>
            )}
            <div className="modal-actions">
              <button onClick={onClose}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
