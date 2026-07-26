import { useEffect, useRef, useState } from 'preact/hooks';
import { vscode } from './vscode';

export function AddTokenModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [secret, setSecret] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => nameRef.current?.focus(), []);

  function submit() {
    const trimmedName = name.trim();
    const trimmedSecret = secret.trim();
    if (!trimmedName || !trimmedSecret) { return; }
    vscode.postMessage({ type: 'add_hf_token', name: trimmedName, secret: trimmedSecret });
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) { onClose(); } }}>
      <div className="modal-box narrow-box" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3>Add HuggingFace Token</h3>
        <p className="modal-intro">
          This token grants access to gated HuggingFace repositories. It is stored securely in VS Code&apos;s
          keychain.
        </p>
        <div className="modal-field">
          <label for="add-token-name">Token name</label>
          <input
            ref={nameRef}
            type="text"
            id="add-token-name"
            autocomplete="off"
            placeholder="e.g. work, personal"
            value={name}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
          />
        </div>
        <div className="modal-field">
          <label for="add-token-secret">Access token</label>
          <input
            type="password"
            id="add-token-secret"
            autocomplete="off"
            placeholder="Paste HF access token"
            value={secret}
            onInput={(e) => setSecret((e.target as HTMLInputElement).value)}
          />
        </div>
        <div className="modal-actions">
          <button className="secondary-btn" onClick={onClose}>Cancel</button>
          <button onClick={submit}>Add token</button>
        </div>
      </div>
    </div>
  );
}
