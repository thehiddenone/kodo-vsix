import { useEffect, useRef, useState } from 'preact/hooks';
import { DEFAULT_CONTEXT_WINDOW, nameTaken, parseLlamaArgs, parseNonNegativeInt } from './localLlmUtils';
import type { LocalRegistryEntry } from './types';
import { vscode } from './vscode';

interface AddFileModalProps {
  localRegistry: LocalRegistryEntry[];
  /** The path chosen in the native picker, relayed from the host via the
   *  `gguf_file_picked` message — lifted to the App shell since it survives
   *  the async round trip to the native dialog. */
  pickedPath: string | null;
  onClose: () => void;
}

export function AddFileModal({ localRegistry, pickedPath, onClose }: AddFileModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [llamaArgs, setLlamaArgs] = useState('');
  const [contextWindow, setContextWindow] = useState(String(DEFAULT_CONTEXT_WINDOW));
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => nameRef.current?.focus(), []);

  const trimmedName = name.trim();
  const nameDup = Boolean(trimmedName) && nameTaken(localRegistry, trimmedName);
  const canSubmit = Boolean(trimmedName) && !nameDup && Boolean(pickedPath);

  function submit() {
    if (!canSubmit || !pickedPath) { return; }
    vscode.postMessage({
      type: 'add_file',
      name: trimmedName,
      description: description.trim(),
      path: pickedPath,
      llama_args: parseLlamaArgs(llamaArgs),
      context_window: parseNonNegativeInt(contextWindow),
    });
    onClose();
  }

  return (
    <div className="li-modal-overlay open" onClick={(e) => { if (e.target === e.currentTarget) { onClose(); } }}>
      <div className="modal-dialog" role="dialog" aria-modal="true">
        <h3>Add local LLM (GGUF) from file</h3>
        <div className="modal-field">
          <label for="file-name">LLM name</label>
          <input
            ref={nameRef}
            type="text"
            id="file-name"
            autocomplete="off"
            value={name}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
          />
          <div className="field-error">{nameDup ? `An LLM named "${trimmedName}" already exists.` : ''}</div>
        </div>
        <div className="modal-field">
          <label for="file-description">Description (optional)</label>
          <input
            type="text"
            id="file-description"
            autocomplete="off"
            value={description}
            onInput={(e) => setDescription((e.target as HTMLInputElement).value)}
          />
        </div>
        <div className="modal-field">
          <label>GGUF file</label>
          <div className="file-picker-row">
            <span className="file-picker-label" id="file-picked-label">{pickedPath || 'No file selected'}</span>
            <button
              className="secondary-btn"
              type="button"
              id="file-select-btn"
              onClick={() => vscode.postMessage({ type: 'pick_gguf_file' })}
            >
              Select file
            </button>
          </div>
        </div>
        <div className="modal-field">
          <label for="file-llama-args">llama_args (optional)</label>
          <input
            type="text"
            id="file-llama-args"
            placeholder="--cache-type-k q8_0 --cache-type-v q8_0"
            autocomplete="off"
            value={llamaArgs}
            onInput={(e) => setLlamaArgs((e.target as HTMLInputElement).value)}
          />
          <div className="field-hint">Space-separated CLI flags passed verbatim to llama-server.</div>
        </div>
        <div className="modal-field">
          <label for="file-context-window">Context window size (optional)</label>
          <input
            type="number"
            id="file-context-window"
            min="1"
            step="1"
            value={contextWindow}
            onInput={(e) => setContextWindow((e.target as HTMLInputElement).value)}
          />
        </div>
        <div className="modal-actions">
          <button id="file-add-btn" disabled={!canSubmit} onClick={submit}>Add</button>
          <button className="secondary-btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
