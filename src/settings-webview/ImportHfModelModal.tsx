import { useEffect, useRef, useState } from 'preact/hooks';
import { HF_REPO_RE } from './localLlmUtils';
import { vscode } from './vscode';

interface ImportHfModelModalProps {
  onClose: () => void;
}

/**
 * Ask for one Hugging Face GGUF repository id and hand it to the Model Importer
 * agent, which runs in a new read-only session tab (`import_hf_with_agent`,
 * kodo/doc/LLM_REGISTRY.md §4.0b). The agent — not this form — picks the
 * quants, reads their GGUF headers and writes the catalog entries.
 */
export function ImportHfModelModal({ onClose }: ImportHfModelModalProps) {
  const [repoId, setRepoId] = useState('');
  const repoRef = useRef<HTMLInputElement>(null);
  useEffect(() => repoRef.current?.focus(), []);

  const trimmedRepoId = repoId.trim();
  const repoValid = HF_REPO_RE.test(trimmedRepoId);

  function submit() {
    if (!repoValid) { return; }
    vscode.postMessage({ type: 'import_hf_with_agent', repo_id: trimmedRepoId });
    onClose();
  }

  return (
    <div className="li-modal-overlay open" onClick={(e) => { if (e.target === e.currentTarget) { onClose(); } }}>
      <div className="modal-dialog" role="dialog" aria-modal="true">
        <h3>Add local LLM (GGUF) from huggingface.com</h3>
        <div className="modal-field">
          <label for="hf-repo-id">Hugging Face GGUF repository</label>
          <input
            ref={repoRef}
            type="text"
            id="hf-repo-id"
            placeholder="unsloth/Qwen3.8-27B-GGUF"
            autocomplete="off"
            value={repoId}
            onInput={(e) => setRepoId((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { submit(); } }}
          />
          <div className="field-error">{trimmedRepoId && !repoValid ? 'Expected the form "account/repo".' : ''}</div>
          <div className="field-hint">
            The Model Importer agent reads the repository, picks one quant per precision tier, checks each
            quant's GGUF header for built-in MTP, and adds them to your local LLMs. It works in a new session
            tab you can watch but not type into. Nothing is downloaded until you install a quant.
          </div>
        </div>
        <div className="modal-actions">
          <button id="hf-import-btn" disabled={!repoValid} onClick={submit}>Import</button>
          <button className="secondary-btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
