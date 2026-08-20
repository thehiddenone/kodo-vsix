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
  // AWS Bedrock only -- see `isAws` below.
  const [accessKeyId, setAccessKeyId] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => nameRef.current?.focus(), []);
  const vendorLabel = CLOUD_VENDORS[vendor]?.label || vendor;
  // AWS authenticates with a long-term IAM user access key -- a *pair* of
  // values -- where every other vendor here uses one opaque string. Rather
  // than widen the credential protocol for one vendor, the two fields are
  // packed into a single JSON blob that travels the existing
  // one-secret-per-vendor channel untouched, and only the Bedrock plugin
  // knows the string is structured (kodo/doc/LLM_REGISTRY.md §3b). The
  // region is deliberately NOT collected here: it is not a secret, and lives
  // in the Bedrock tab's own region picker.
  const isAws = vendor === 'bedrock';

  function submit() {
    const trimmedName = name.trim();
    const trimmedSecret = secret.trim();
    if (!trimmedName || !trimmedSecret || !vendor) { return; }
    const trimmedAccessKeyId = accessKeyId.trim();
    if (isAws && !trimmedAccessKeyId) { return; }
    const payloadSecret = isAws
      ? JSON.stringify({ access_key_id: trimmedAccessKeyId, secret_access_key: trimmedSecret })
      : trimmedSecret;
    vscode.postMessage({ type: 'add_key', vendor, name: trimmedName, secret: payloadSecret });
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) { onClose(); } }}>
      <div className="modal-box narrow-box" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3>{isAws ? 'Add AWS access key' : 'Add API key'}</h3>
        <p className="modal-intro">
          {isAws
            ? 'Kōdo signs AWS Bedrock requests with a long-term IAM user access key. Pick the region separately, on the AWS Bedrock page.'
            : `This API key will be used for ${vendorLabel}.`}
        </p>
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
        {isAws && (
          <div className="modal-field">
            <label for="add-key-access-key-id">Access key ID</label>
            <input
              type="text"
              id="add-key-access-key-id"
              autocomplete="off"
              placeholder="AKIA…"
              value={accessKeyId}
              onInput={(e) => setAccessKeyId((e.target as HTMLInputElement).value)}
            />
          </div>
        )}
        <div className="modal-field">
          <label for="add-key-secret">{isAws ? 'Secret access key' : 'API key'}</label>
          <input
            type="password"
            id="add-key-secret"
            autocomplete="off"
            placeholder={isAws ? 'Paste secret access key' : 'Paste API key'}
            value={secret}
            onInput={(e) => setSecret((e.target as HTMLInputElement).value)}
          />
        </div>
        <div className="modal-actions">
          <button className="secondary-btn" onClick={onClose}>Cancel</button>
          <button onClick={submit}>{isAws ? 'Add access key' : 'Add API key'}</button>
        </div>
      </div>
    </div>
  );
}
