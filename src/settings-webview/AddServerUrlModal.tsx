import { useEffect, useRef, useState } from 'preact/hooks';
import { nameTaken } from './localLlmUtils';
import type { LocalRegistryEntry } from './types';
import { vscode } from './vscode';

interface AddServerUrlModalProps {
  localRegistry: LocalRegistryEntry[];
  onClose: () => void;
}

function isValidHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function AddServerUrlModal({ localRegistry, onClose }: AddServerUrlModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [url, setUrl] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => nameRef.current?.focus(), []);

  const trimmedName = name.trim();
  const trimmedUrl = url.trim();
  const urlValid = isValidHttpUrl(trimmedUrl);
  const nameDup = Boolean(trimmedName) && nameTaken(localRegistry, trimmedName);
  const canSubmit = Boolean(trimmedName) && !nameDup && urlValid;

  function submit() {
    if (!canSubmit) { return; }
    vscode.postMessage({ type: 'add_server_url', name: trimmedName, description: description.trim(), url: trimmedUrl });
    onClose();
  }

  return (
    <div className="li-modal-overlay open" onClick={(e) => { if (e.target === e.currentTarget) { onClose(); } }}>
      <div className="modal-dialog" role="dialog" aria-modal="true">
        <h3>Add a link to self-hosted llama-server</h3>
        <div className="modal-field">
          <label for="server-name">LLM name</label>
          <input
            ref={nameRef}
            type="text"
            id="server-name"
            autocomplete="off"
            value={name}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
          />
          <div className="field-error">{nameDup ? `An LLM named "${trimmedName}" already exists.` : ''}</div>
        </div>
        <div className="modal-field">
          <label for="server-description">Description (optional)</label>
          <input
            type="text"
            id="server-description"
            autocomplete="off"
            value={description}
            onInput={(e) => setDescription((e.target as HTMLInputElement).value)}
          />
        </div>
        <div className="modal-field">
          <label for="server-url">Self-hosted llama-server URL</label>
          <input
            type="text"
            id="server-url"
            placeholder="http://192.168.1.50:8042"
            autocomplete="off"
            value={url}
            onInput={(e) => setUrl((e.target as HTMLInputElement).value)}
          />
          <div className="field-error">{trimmedUrl && !urlValid ? 'Enter a valid http(s) URL.' : ''}</div>
        </div>
        <div className="modal-actions">
          <button id="server-add-btn" disabled={!canSubmit} onClick={submit}>Add</button>
          <button className="secondary-btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
