import { useEffect, useRef, useState } from 'preact/hooks';
import { DEFAULT_CONTEXT_WINDOW, HF_REPO_RE, nameTaken, parseLlamaArgs, parseNonNegativeInt } from './localLlmUtils';
import type { LocalRegistryEntry } from './types';
import { vscode } from './vscode';

interface AddHuggingfaceModalProps {
  localRegistry: LocalRegistryEntry[];
  onClose: () => void;
}

export function AddHuggingfaceModal({ localRegistry, onClose }: AddHuggingfaceModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [repoId, setRepoId] = useState('');
  const [filename, setFilename] = useState('');
  const [llamaArgs, setLlamaArgs] = useState('');
  const [contextWindow, setContextWindow] = useState(String(DEFAULT_CONTEXT_WINDOW));
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => nameRef.current?.focus(), []);

  const trimmedName = name.trim();
  const trimmedRepoId = repoId.trim();
  const trimmedFilename = filename.trim();
  const repoValid = HF_REPO_RE.test(trimmedRepoId);
  const filenameValid = trimmedFilename.toLowerCase().endsWith('.gguf') && trimmedFilename.length > '.gguf'.length;
  const nameDup = Boolean(trimmedName) && nameTaken(localRegistry, trimmedName);
  const canSubmit = Boolean(trimmedName) && !nameDup && repoValid && filenameValid;

  function submit() {
    if (!canSubmit) { return; }
    vscode.postMessage({
      type: 'add_huggingface',
      name: trimmedName,
      description: description.trim(),
      repo_id: trimmedRepoId,
      filename: trimmedFilename,
      llama_args: parseLlamaArgs(llamaArgs),
      context_window: parseNonNegativeInt(contextWindow),
    });
    onClose();
  }

  return (
    <div className="li-modal-overlay open" onClick={(e) => { if (e.target === e.currentTarget) { onClose(); } }}>
      <div className="modal-dialog" role="dialog" aria-modal="true">
        <h3>Add local LLM (GGUF) from huggingface.com</h3>
        <div className="modal-field">
          <label for="hf-name">LLM name</label>
          <input
            ref={nameRef}
            type="text"
            id="hf-name"
            autocomplete="off"
            value={name}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
          />
          <div className="field-error">{nameDup ? `An LLM named "${trimmedName}" already exists.` : ''}</div>
        </div>
        <div className="modal-field">
          <label for="hf-description">Description (optional)</label>
          <input
            type="text"
            id="hf-description"
            autocomplete="off"
            value={description}
            onInput={(e) => setDescription((e.target as HTMLInputElement).value)}
          />
        </div>
        <div className="modal-field">
          <label for="hf-repo-id">HuggingFace repository ID</label>
          <input
            type="text"
            id="hf-repo-id"
            placeholder="vendor/repo"
            autocomplete="off"
            value={repoId}
            onInput={(e) => setRepoId((e.target as HTMLInputElement).value)}
          />
          <div className="field-error">{trimmedRepoId && !repoValid ? 'Expected the form "account/repo".' : ''}</div>
        </div>
        <div className="modal-field">
          <label for="hf-filename">GGUF filename</label>
          <input
            type="text"
            id="hf-filename"
            placeholder="model.gguf"
            autocomplete="off"
            value={filename}
            onInput={(e) => setFilename((e.target as HTMLInputElement).value)}
          />
          <div className="field-error">{trimmedFilename && !filenameValid ? 'Filename must end with ".gguf".' : ''}</div>
        </div>
        <div className="modal-field">
          <label for="hf-llama-args">llama_args (optional)</label>
          <input
            type="text"
            id="hf-llama-args"
            placeholder="--cache-type-k q8_0 --cache-type-v q8_0"
            autocomplete="off"
            value={llamaArgs}
            onInput={(e) => setLlamaArgs((e.target as HTMLInputElement).value)}
          />
          <div className="field-hint">Space-separated CLI flags passed verbatim to llama-server.</div>
        </div>
        <div className="modal-field">
          <label for="hf-context-window">Context window size (optional)</label>
          <input
            type="number"
            id="hf-context-window"
            min="1"
            step="1"
            value={contextWindow}
            onInput={(e) => setContextWindow((e.target as HTMLInputElement).value)}
          />
        </div>
        <div className="modal-actions">
          <button id="hf-add-btn" disabled={!canSubmit} onClick={submit}>Add</button>
          <button className="secondary-btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
