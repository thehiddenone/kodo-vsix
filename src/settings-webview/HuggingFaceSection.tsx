import type { HfTokenEntry } from './types';
import { vscode } from './vscode';

interface HuggingFaceSectionProps {
  hfTokens: HfTokenEntry[];
  onAddToken: () => void;
}

export function HuggingFaceSection({ hfTokens, onAddToken }: HuggingFaceSectionProps) {
  const tokens = hfTokens || [];
  return (
    <div>
      <div className="section-subheading">HuggingFace Access Tokens</div>
      <p className="intro-text">
        Manage access tokens for downloading gated models from HuggingFace Hub. Tokens are stored securely in VS
        Code&apos;s keychain and never written to disk.
      </p>
      <div className="keys-section">
        {tokens.length === 0 ? (
          <div id="no-tokens-msg">No HuggingFace access tokens configured yet.</div>
        ) : (
          tokens.map((token) => (
            <div className="key-row" key={token.uuid}>
              <span className="key-name">{token.name}</span>
              {token.active ? (
                <span className="key-active-badge">Active</span>
              ) : (
                <button
                  className="secondary-btn"
                  onClick={() => vscode.postMessage({ type: 'activate_hf_token', uuid: token.uuid })}
                >
                  Make active
                </button>
              )}
              <button
                className="secondary-btn"
                onClick={() => vscode.postMessage({ type: 'remove_hf_token', uuid: token.uuid })}
              >
                Remove this token
              </button>
            </div>
          ))
        )}
        <button id="add-key-btn" style={{ marginTop: '15px' }} onClick={onAddToken}>Add new token</button>
      </div>
    </div>
  );
}
