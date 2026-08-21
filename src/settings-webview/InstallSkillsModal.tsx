import { useEffect, useRef, useState } from 'preact/hooks';
import type { SkillEntry, SkillInstallResult, SkillScanResult } from './types';
import { vscode } from './vscode';

interface InstallSkillsModalProps {
  /** The already-installed skills — used only to flag a scanned candidate
   * that would overwrite one of these (kodo/doc/SKILLS.md §2). */
  existingSkills: SkillEntry[];
  /** Latest `skills.install_scan` reply pushed into panel state, or `null`
   * before the first one. Compared against `submittedUrl` below so a reply
   * left over from an earlier, already-closed instance of this modal is
   * never mistaken for one answering the current request. */
  scan: SkillScanResult | null;
  /** Latest `skills.install` reply, same staleness guard as `scan`. */
  install: SkillInstallResult | null;
  onClose: () => void;
}

type Step = 'url' | 'select' | 'installing' | 'result';

/** "Install from a repository" — the URL → checkbox-picker → results flow
 * (kodo/doc/SKILLS.md §2, kodo/doc/WS_PROTOCOL.md §7.6j). A fresh mount
 * starts with an empty `submittedUrl`, which is what keeps a `scan`/`install`
 * prop still holding a previous instance's result from being read as an
 * answer to a request this instance never made — see the two effects below. */
export function InstallSkillsModal({ existingSkills, scan, install, onClose }: InstallSkillsModalProps) {
  const [repoUrl, setRepoUrl] = useState('');
  const [step, setStep] = useState<Step>('url');
  const [scanning, setScanning] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [submittedUrl, setSubmittedUrl] = useState('');
  const urlRef = useRef<HTMLInputElement>(null);
  useEffect(() => urlRef.current?.focus(), []);

  const existingNames = new Set(existingSkills.map((s) => s.name));

  useEffect(() => {
    if (!scanning || !scan || scan.repoUrl !== submittedUrl) { return; }
    setScanning(false);
    if (scan.ok && scan.skills.length > 0) {
      // Pre-check every non-conflicting skill; a skill that would overwrite
      // one already installed starts unchecked, so overwriting is always a
      // deliberate opt-in rather than a side effect of "Select All"-by-default.
      setChecked(new Set(scan.skills.filter((s) => !existingNames.has(s.name)).map((s) => s.name)));
      setStep('select');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scan]);

  useEffect(() => {
    if (step !== 'installing' || !install || install.repoUrl !== submittedUrl) { return; }
    setStep('result');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [install]);

  function submitScan() {
    const trimmed = repoUrl.trim();
    if (!trimmed || scanning) { return; }
    setSubmittedUrl(trimmed);
    setScanning(true);
    vscode.postMessage({ type: 'scan_skill_repo', repoUrl: trimmed });
  }

  function submitInstall() {
    if (checked.size === 0 || !scan) { return; }
    const selected = scan.skills
      .filter((s) => checked.has(s.name))
      .map((s) => ({ name: s.name, overwrite: existingNames.has(s.name) }));
    setStep('installing');
    vscode.postMessage({ type: 'install_skills', repoUrl: submittedUrl, install: selected });
  }

  const scanAnsweredThisUrl = scan !== null && scan.repoUrl === submittedUrl && !scanning;
  const scanFoundNothingToInstall = scanAnsweredThisUrl && scan!.ok && scan!.skills.length === 0;
  const scanFailed = scanAnsweredThisUrl && !scan!.ok;

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) { onClose(); } }}>
      <div className="modal-box" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3>Install skills from a repository</h3>

        {step === 'url' && (
          <>
            <p className="modal-intro">
              Kōdo clones the repository with <span className="value-code">git</span>, scans it
              for <span className="value-code">SKILL.md</span> files, and lets you choose which of
              the skills it finds to install.
            </p>
            <div className="modal-field">
              <label for="skill-repo-url">Repository URL</label>
              <input
                ref={urlRef}
                type="text"
                id="skill-repo-url"
                autocomplete="off"
                placeholder="https://github.com/owner/repo"
                value={repoUrl}
                onInput={(e) => setRepoUrl((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { submitScan(); } }}
                disabled={scanning}
              />
              {scanFailed && <div className="field-error">{scan!.error}</div>}
              {scanFoundNothingToInstall && (
                <div className="field-error">No valid skills were found in this repository.</div>
              )}
            </div>
            <div className="modal-actions">
              <button className="secondary-btn" onClick={onClose}>Cancel</button>
              <button onClick={submitScan} disabled={scanning || !repoUrl.trim()}>
                {scanning ? 'Scanning…' : 'Scan'}
              </button>
            </div>
          </>
        )}

        {step === 'select' && scan && scan.ok && (
          <>
            <p className="modal-intro">
              Found {scan.skills.length} skill{scan.skills.length === 1 ? '' : 's'} in{' '}
              <span className="value-code">{submittedUrl}</span>. Choose which to install.
            </p>
            <div className="rule-table">
              {scan.skills.map((s) => (
                <label className="skill-pick-row" key={s.name}>
                  <input
                    type="checkbox"
                    checked={checked.has(s.name)}
                    onChange={(e) => {
                      const next = new Set(checked);
                      if ((e.target as HTMLInputElement).checked) {
                        next.add(s.name);
                      } else {
                        next.delete(s.name);
                      }
                      setChecked(next);
                    }}
                  />
                  <div className="skill-pick-info">
                    <div className="skill-pick-name">{s.name}</div>
                    <div className="skill-pick-desc">{s.description}</div>
                    {existingNames.has(s.name) && (
                      <div className="skill-pick-conflict">
                        Already installed locally — will be overwritten.
                      </div>
                    )}
                  </div>
                </label>
              ))}
            </div>
            <div className="modal-actions">
              <button className="secondary-btn" onClick={onClose}>Cancel</button>
              <button onClick={submitInstall} disabled={checked.size === 0}>
                Install{checked.size > 0 ? ` (${checked.size})` : ''}
              </button>
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
                    ? `Installed ${install.installed.length} skill${install.installed.length === 1 ? '' : 's'}:`
                    : 'Nothing was installed.'}
                </p>
                {install.installed.length > 0 && (
                  <ul className="install-result-list">
                    {install.installed.map((name) => <li key={name}>{name}</li>)}
                  </ul>
                )}
                {install.conflicts.length > 0 && (
                  <p className="field-error">
                    Skipped (already installed, not confirmed): {install.conflicts.join(', ')}
                  </p>
                )}
                {install.missing.length > 0 && (
                  <p className="field-error">
                    Skipped (no longer found in the repository): {install.missing.join(', ')}
                  </p>
                )}
              </>
            ) : (
              <p className="field-error">Could not install these skills — {install.error}</p>
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
