import { useEffect, useRef, useState } from 'preact/hooks';
import { CLOUD_VENDORS } from './types';
import { vscode } from './vscode';

interface AddKeyModalProps {
  vendor: string;
  onClose: () => void;
}

export function AddKeyModal({ vendor, onClose }: AddKeyModalProps) {
  const [name, setName] = useState('');
  const [secret, setSecret] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => nameRef.current?.focus(), []);
  const vendorLabel = CLOUD_VENDORS[vendor]?.label || vendor;

  function submit() {
    const trimmedName = name.trim();
    const trimmedSecret = secret.trim();
    if (!trimmedName || !trimmedSecret || !vendor) { return; }
    vscode.postMessage({ type: 'add_key', vendor, name: trimmedName, secret: trimmedSecret });
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) { onClose(); } }}>
      <div className="modal-box narrow-box" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3>Add API key</h3>
        <p className="modal-intro">This API key will be used for {vendorLabel}.</p>
        <div className="modal-field">
          <label for="add-key-name">Key name</label>
          <input
            ref={nameRef}
            type="text"
            id="add-key-name"
            autocomplete="off"
            placeholder="e.g. work, personal"
            value={name}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
          />
        </div>
        <div className="modal-field">
          <label for="add-key-secret">API key</label>
          <input
            type="password"
            id="add-key-secret"
            autocomplete="off"
            placeholder="Paste API key"
            value={secret}
            onInput={(e) => setSecret((e.target as HTMLInputElement).value)}
          />
        </div>
        <div className="modal-actions">
          <button className="secondary-btn" onClick={onClose}>Cancel</button>
          <button onClick={submit}>Add API key</button>
        </div>
      </div>
    </div>
  );
}
