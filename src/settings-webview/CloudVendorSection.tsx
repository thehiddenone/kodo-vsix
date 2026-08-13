import { CLOUD_VENDORS, EFFORT_EXAMPLES, EFFORT_LABELS, EFFORT_LEVELS } from './types';
import type { ApiKeyEntry, CloudRegistry, CloudVendorRegistryInfo, EffortLevel } from './types';
import { vscode } from './vscode';

function CloudKeysSection({ vendor, vendorLabel, keys, onAddKey }: {
  vendor: string;
  vendorLabel: string;
  keys: ApiKeyEntry[];
  onAddKey: () => void;
}) {
  return (
    <div className="keys-section">
      <div className="section-heading">API access keys</div>
      <hr className="section-divider" />
      {keys.length === 0 ? (
        <div id="no-keys-msg">No API keys configured for {vendorLabel} yet.</div>
      ) : (
        keys.map((key) => (
          <div className="key-row" key={key.uuid}>
            <span className="key-name">{key.name}</span>
            {key.active ? (
              <span className="key-active-badge">Active</span>
            ) : (
              <button
                className="secondary-btn"
                onClick={() => vscode.postMessage({ type: 'make_active', vendor, uuid: key.uuid })}
              >
                Make active
              </button>
            )}
            <button
              className="secondary-btn"
              onClick={() => vscode.postMessage({ type: 'forget_key', vendor, uuid: key.uuid })}
            >
              Forget this key
            </button>
          </div>
        ))
      )}
      <button id="add-key-btn" style={{ marginTop: '15px' }} onClick={onAddKey}>Add new API access key</button>
    </div>
  );
}

function EffortSection({ vendor, info, effort, modelId }: {
  vendor: string;
  info: CloudVendorRegistryInfo;
  effort: EffortLevel;
  modelId: string | undefined;
}) {
  const current = modelId && info.models.some((m) => m.model_id === modelId) ? modelId : info.models[0]?.model_id;
  const selected = info.models.find((m) => m.model_id === current) ?? null;
  return (
    <div>
      <div className="effort-title">{EFFORT_LABELS[effort]}</div>
      <div className="effort-example">{EFFORT_EXAMPLES[effort]}</div>
      <select
        className="settings-select model-select"
        value={current}
        onChange={(e) => vscode.postMessage({
          type: 'set_cloud_model', vendor, effort, model_id: (e.target as HTMLSelectElement).value,
        })}
      >
        {info.models.map((model) => <option key={model.model_id} value={model.model_id}>{model.name}</option>)}
      </select>
      {selected && (
        <div className="model-detail">
          <span className="model-name">{selected.name}</span>
          {selected.recommendation && <span className="model-recommendation">{selected.recommendation}</span>}
        </div>
      )}
    </div>
  );
}

/** Meta-only: the account-wide "contributor" pricing tier toggle
 * (kodo/doc/SETTINGS.md §2.2a) -- trades a heavy discount for permission to
 * train future Meta models on the account's prompts/completions. Off by
 * default; turning it on shows a persistent warning (reusing the same
 * `.ram-warning.yellow` treatment the Local Inference tab uses for its own
 * "heads up" banners) since real-world eligibility is country-restricted and
 * kodo-vsix has no way to verify it client-side. */
function MetaContributorSection({ enabled, onChange }: {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <div>
      <hr className="section-divider" />
      <div className="section-heading">Contributor tier</div>
      <p className="intro-text">
        Meta offers a heavily discounted "contributor" tier in exchange for permission to use your prompts
        and completions to train future Meta models. Off by default — your traffic is never used for
        training unless you turn this on.
      </p>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onChange((e.target as HTMLInputElement).checked)}
        />
        Enable the contributor tier for Meta
      </label>
      {enabled && (
        <div className="ram-warning yellow">
          ⚠️ The contributor tier is only available in selected countries. Check Meta's Model API
          documentation online to confirm your account is eligible before relying on it.
        </div>
      )}
    </div>
  );
}

function CloudVendorPanel({ vendor, info, keys, modelsByVendor, onAddKey, metaContributorTier, onSetMetaContributorTier }: {
  vendor: string;
  info: CloudVendorRegistryInfo;
  keys: ApiKeyEntry[];
  modelsByVendor: Record<string, string>;
  onAddKey: () => void;
  metaContributorTier: boolean;
  onSetMetaContributorTier: (enabled: boolean) => void;
}) {
  const vendorMeta = CLOUD_VENDORS[vendor] || { icon: '🧩' };
  return (
    <div>
      <h2>{vendorMeta.icon} {info.display_name} LLMs</h2>
      <hr className="section-divider" />
      <p className="intro-text">
        Configure access to {info.display_name}&apos;s models: add or remove API access tokens, and choose which
        model handles each level of effort, from quick low-effort subagent tasks up to the hardest max-effort
        problems.
      </p>
      <CloudKeysSection vendor={vendor} vendorLabel={info.display_name} keys={keys} onAddKey={onAddKey} />
      {EFFORT_LEVELS.map((effort) => (
        <div key={effort}>
          <hr className="section-divider" />
          <EffortSection vendor={vendor} info={info} effort={effort} modelId={modelsByVendor[effort]} />
        </div>
      ))}
      {vendor === 'meta' && (
        <MetaContributorSection enabled={metaContributorTier} onChange={onSetMetaContributorTier} />
      )}
    </div>
  );
}

function CloudComingSoon({ vendor }: { vendor: string }) {
  const vendorMeta = CLOUD_VENDORS[vendor] || { icon: '🧩', label: vendor, coming_soon_text: 'Support for this vendor is on the way.' };
  return (
    <div className="coming-soon">
      <h2>{vendorMeta.icon} {vendorMeta.label}</h2>
      <hr className="section-divider" />
      <p>{vendorMeta.coming_soon_text}</p>
      <span className="badge">Coming soon</span>
    </div>
  );
}

interface CloudVendorSectionProps {
  vendor: string;
  cloudRegistry: CloudRegistry;
  modelsByVendor: Record<string, Record<string, string>>;
  keysByVendor: Record<string, ApiKeyEntry[]>;
  onAddKey: (vendor: string) => void;
  metaContributorTier: boolean;
  onSetMetaContributorTier: (enabled: boolean) => void;
}

export function CloudVendorSection({
  vendor, cloudRegistry, modelsByVendor, keysByVendor, onAddKey, metaContributorTier, onSetMetaContributorTier,
}: CloudVendorSectionProps) {
  const info = cloudRegistry[vendor];
  if (!info) {
    return <CloudComingSoon vendor={vendor} />;
  }
  return (
    <CloudVendorPanel
      vendor={vendor}
      info={info}
      keys={keysByVendor[vendor] || []}
      modelsByVendor={modelsByVendor[vendor] || {}}
      onAddKey={() => onAddKey(vendor)}
      metaContributorTier={metaContributorTier}
      onSetMetaContributorTier={onSetMetaContributorTier}
    />
  );
}
