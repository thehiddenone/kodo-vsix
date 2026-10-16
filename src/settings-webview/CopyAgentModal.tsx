import { useEffect, useRef, useState } from 'preact/hooks';
import type { AgentCopyResult, AgentCopyScanResult, BuiltinAgentEntry } from './types';
import { vscode } from './vscode';

interface CopyAgentModalProps {
  /** The built-ins `agents.copy` accepts, from the Agents listing. */
  builtins: BuiltinAgentEntry[];
  /** The built-in to preselect (a "Built-in agents" row's Copy); `''` = the first. */
  initialName: string;
  /** Latest `agents.copy_scan` reply, or `null` before the first. Matched on
   * name + prefix against what this instance asked for, so a reply left over
   * from an earlier instance is never read as an answer to this one. */
  scan: AgentCopyScanResult | null;
  /** Latest `agents.copy` reply, same staleness guard as `scan`. */
  copy: AgentCopyResult | null;
  onClose: () => void;
}

type Step = 'pick' | 'review' | 'copying' | 'result';

/** "Copy a built-in agent" — pick → review → result (kodo/doc/AGENT_BUILDER.md
 * §3.5, kodo/doc/WS_PROTOCOL.md §7.6l).
 *
 * A copy is the built-in's whole closure — the agent, every sub-agent it
 * lists and every critic they pair with — renamed by one prefix that replaces
 * `kodo_`. The review step shows that closure before anything is written, and,
 * when some of the new names are already taken, asks keep-or-replace once for
 * all of them in the server's own words, exactly as the install modal does. */
export function CopyAgentModal({ builtins, initialName, scan, copy, onClose }: CopyAgentModalProps) {
  const [name, setName] = useState(
    builtins.some((b) => b.name === initialName) ? initialName : (builtins[0]?.name ?? ''),
  );
  const [prefix, setPrefix] = useState('');
  const [step, setStep] = useState<Step>('pick');
  const [scanning, setScanning] = useState(false);
  const [submitted, setSubmitted] = useState<{ name: string; prefix: string } | null>(null);
  const prefixRef = useRef<HTMLInputElement>(null);
  useEffect(() => prefixRef.current?.focus(), []);

  const answers = (reply: { name: string; prefix: string } | null): boolean =>
    reply !== null && submitted !== null
    && reply.name === submitted.name && reply.prefix === submitted.prefix;

  useEffect(() => {
    if (!scanning || !answers(scan)) {
      return;
    }
    setScanning(false);
    if (scan!.ok) {
      setStep('review');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scan]);

  useEffect(() => {
    if (step !== 'copying' || !answers(copy)) {
      return;
    }
    setStep('result');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [copy]);

  function submitScan() {
    const trimmed = prefix.trim();
    if (!name || !trimmed || scanning) {
      return;
    }
    setSubmitted({ name, prefix: trimmed });
    setScanning(true);
    vscode.postMessage({ type: 'scan_agent_copy', name, prefix: trimmed });
  }

  function submitCopy(replace: boolean) {
    if (submitted === null) {
      return;
    }
    setStep('copying');
    vscode.postMessage({ type: 'copy_agent', ...submitted, replace });
  }

  const failed = !scanning && answers(scan) && !scan!.ok;
  const hasConflicts = (scan?.conflicts ?? '') !== '';
  const topLevel = builtins.filter((b) => b.kind === 'agent');
  const subagents = builtins.filter((b) => b.kind !== 'agent');

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
        <h3>Copy a built-in agent</h3>

        {step === 'pick' && (
          <>
            <p className="modal-intro">
              Kōdo copies the agent together with every sub-agent and critic it uses into{' '}
              <span className="value-code">~/.kodo/agents</span>, renaming each one: your prefix
              replaces <span className="value-code">kodo_</span>, so with{' '}
              <span className="value-code">acme_</span> the Guide becomes{' '}
              <span className="value-code">acme_guide</span>. The copy is yours to edit; the
              built-in stays as it is.
            </p>
            <div className="modal-field">
              <label for="copy-source">Built-in agent</label>
              <select
                id="copy-source"
                className="settings-select"
                value={name}
                disabled={scanning}
                onChange={(e) => setName((e.target as HTMLSelectElement).value)}
              >
                <optgroup label="Top-level agents">
                  {topLevel.map((b) => (
                    <option key={b.name} value={b.name}>{b.label} — {b.name}</option>
                  ))}
                </optgroup>
                <optgroup label="Sub-agents">
                  {subagents.map((b) => (
                    <option key={b.name} value={b.name}>{b.label} — {b.name}</option>
                  ))}
                </optgroup>
              </select>
            </div>
            <div className="modal-field">
              <label for="copy-prefix">Prefix</label>
              <input
                ref={prefixRef}
                type="text"
                id="copy-prefix"
                autocomplete="off"
                placeholder="acme_"
                value={prefix}
                onInput={(e) => setPrefix((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    submitScan();
                  }
                }}
                disabled={scanning}
              />
              <div className="field-hint">
                Lowercase letters, digits and underscores, starting with a letter.
              </div>
              {failed && <div className="field-error">{scan!.error}</div>}
            </div>
            <div className="modal-actions">
              <button className="secondary-btn" onClick={onClose}>
                Cancel
              </button>
              <button onClick={submitScan} disabled={scanning || !name || !prefix.trim()}>
                {scanning ? 'Reading…' : 'Next'}
              </button>
            </div>
          </>
        )}

        {step === 'review' && scan && scan.ok && (
          <>
            <p className="modal-intro">
              This copies {scan.members.length} agent{scan.members.length === 1 ? '' : 's'}:
            </p>
            <div className="rule-table">
              {scan.members.map((m) => (
                <div className="skill-pick-row" key={`${m.kind}:${m.name}`}>
                  <div className="skill-pick-info">
                    <div className="skill-pick-name">
                      {m.kind} {m.source} → {m.name}
                    </div>
                    {m.installedVersion !== '' && (
                      <div className="skill-pick-conflict">
                        {m.name} is already installed ({m.installedVersion}).
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {hasConflicts && (
              <>
                <p className="modal-intro">Some of these names are already taken:</p>
                <pre className="install-result-list">{scan.conflicts}</pre>
                <p className="modal-intro">
                  Keep the agents you have under those names, or replace them with fresh copies?
                </p>
              </>
            )}
            <div className="modal-actions">
              <button className="secondary-btn" onClick={() => setStep('pick')}>
                Back
              </button>
              {hasConflicts ? (
                <>
                  <button className="secondary-btn" onClick={() => submitCopy(false)}>
                    Keep installed
                  </button>
                  <button onClick={() => submitCopy(true)}>Replace</button>
                </>
              ) : (
                <button onClick={() => submitCopy(false)}>
                  Copy ({scan.members.length})
                </button>
              )}
            </div>
          </>
        )}

        {step === 'copying' && <p className="modal-intro">Copying…</p>}

        {step === 'result' && copy && (
          <>
            {copy.error === '' || copy.copied.length > 0 ? (
              <>
                <p className="modal-intro">
                  {copy.copied.length > 0
                    ? `Copied ${copy.copied.length} agent${copy.copied.length === 1 ? '' : 's'}:`
                    : 'Nothing was copied.'}
                </p>
                {copy.copied.length > 0 && (
                  <ul className="install-result-list">
                    {copy.copied.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                )}
                {copy.kept.length > 0 && (
                  <p className="field-error">Kept the installed: {copy.kept.join(', ')}</p>
                )}
                {copy.failed.length > 0 && (
                  <p className="field-error">Copied, but Kōdo cannot load: {copy.failed.join('; ')}</p>
                )}
                {copy.error !== '' && <p className="field-error">{copy.error}</p>}
              </>
            ) : (
              <p className="field-error">Could not copy this agent — {copy.error}</p>
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
