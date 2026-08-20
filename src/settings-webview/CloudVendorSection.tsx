import type { ComponentChildren } from 'preact';
import { useMemo, useRef, useState } from 'preact/hooks';
import { BEDROCK_REGIONS, CLOUD_VENDORS, EFFORT_EXAMPLES, EFFORT_LABELS, EFFORT_LEVELS } from './types';
import type { ApiKeyEntry, BedrockModelInfo, CloudRegistry, CloudUniformEntry, CloudVendorRegistryInfo, EffortLevel, OpenRouterModelInfo } from './types';
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

function EffortSection({ vendor, info, effort, modelId, disabled }: {
  vendor: string;
  info: CloudVendorRegistryInfo;
  effort: EffortLevel;
  modelId: string | undefined;
  /** Locked while the vendor's "use one model for all effort levels"
   *  shortcut is enabled (see {@link UniformModelSection}) -- that shortcut
   *  overrides every tier server-side, so editing one here would be
   *  misleading even though the underlying selection is preserved
   *  untouched. */
  disabled?: boolean;
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
        disabled={disabled}
        onChange={(e) => vscode.postMessage({
          type: 'set_cloud_model', vendor, effort, model_id: (e.target as HTMLSelectElement).value,
        })}
      >
        {info.models.map((model) => <option key={model.model_id} value={model.model_id}>{model.name}</option>)}
      </select>
      {disabled ? (
        <div className="model-detail">
          <span className="model-recommendation">Locked to the shortcut model while "use one model for all effort levels" is on.</span>
        </div>
      ) : selected && (
        <div className="model-detail">
          <span className="model-name">{selected.name}</span>
          {selected.recommendation && <span className="model-recommendation">{selected.recommendation}</span>}
        </div>
      )}
    </div>
  );
}

/** Vendor-wide "use one model for all effort levels" shortcut — an
 * alternative to picking a model per effort tier below, for a user who just
 * wants one specific cloud model handling every call to this vendor. Checking
 * the box reveals `picker` (a vendor-appropriate model chooser passed in by
 * the caller) and disables the four per-tier rows beneath; the underlying
 * `models.cloud.<vendor>` map is deliberately left untouched while this is on
 * (kodo/doc/SETTINGS.md's `models.cloud_uniform`) — same non-destructive-
 * override shape as OpenRouter's Auto mode, so unchecking restores whatever
 * was picked per-tier before, with no data loss. */
function UniformModelSection({ enabled, checkboxDisabled, lockedNote, picker, onToggle }: {
  enabled: boolean;
  /** Disabled (and unable to be checked) while a vendor-specific competing
   *  toggle is active — only OpenRouter's Auto mode does this today. */
  checkboxDisabled: boolean;
  /** Shown under the checkbox instead of the picker when `checkboxDisabled`
   *  explains why (e.g. "...while Auto mode is on"). */
  lockedNote?: string;
  picker: ComponentChildren;
  onToggle: (enabled: boolean) => void;
}) {
  return (
    <div>
      <hr className="section-divider" />
      <div className="section-heading">Use one model for all effort levels</div>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={enabled}
          disabled={checkboxDisabled}
          onChange={(e) => onToggle((e.target as HTMLInputElement).checked)}
        />
        Use the same model for every effort level
      </label>
      {checkboxDisabled && lockedNote && (
        <div className="model-detail">
          <span className="model-recommendation">{lockedNote}</span>
        </div>
      )}
      {enabled && !checkboxDisabled && picker}
    </div>
  );
}

/** Plain-`<select>` model picker for {@link UniformModelSection} on a
 * compiled-in-registry vendor (Anthropic/OpenAI/Meta/Google/Alibaba/
 * DeepSeek/Kimi) — mirrors {@link EffortSection}'s own `<select>` exactly,
 * just writing `model_id` rather than one effort tier. */
function UniformModelSelect({ info, modelId, onSelect }: {
  info: CloudVendorRegistryInfo;
  modelId: string | null;
  onSelect: (modelId: string) => void;
}) {
  const current = modelId && info.models.some((m) => m.model_id === modelId) ? modelId : info.models[0]?.model_id;
  return (
    <select
      className="settings-select model-select"
      value={current}
      onChange={(e) => onSelect((e.target as HTMLSelectElement).value)}
    >
      {info.models.map((model) => <option key={model.model_id} value={model.model_id}>{model.name}</option>)}
    </select>
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

function CloudVendorPanel({
  vendor, info, keys, modelsByVendor, onAddKey, metaContributorTier, onSetMetaContributorTier,
  cloudUniform, onSetCloudUniformEnabled, onSetCloudUniformModel,
}: {
  vendor: string;
  info: CloudVendorRegistryInfo;
  keys: ApiKeyEntry[];
  modelsByVendor: Record<string, string>;
  onAddKey: () => void;
  metaContributorTier: boolean;
  onSetMetaContributorTier: (enabled: boolean) => void;
  cloudUniform: CloudUniformEntry;
  onSetCloudUniformEnabled: (enabled: boolean) => void;
  onSetCloudUniformModel: (modelId: string) => void;
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
      <UniformModelSection
        enabled={cloudUniform.enabled}
        checkboxDisabled={false}
        picker={<UniformModelSelect info={info} modelId={cloudUniform.modelId} onSelect={onSetCloudUniformModel} />}
        onToggle={onSetCloudUniformEnabled}
      />
      {EFFORT_LEVELS.map((effort) => (
        <div key={effort}>
          <hr className="section-divider" />
          <EffortSection
            vendor={vendor}
            info={info}
            effort={effort}
            modelId={modelsByVendor[effort]}
            disabled={cloudUniform.enabled}
          />
        </div>
      ))}
      {vendor === 'meta' && (
        <MetaContributorSection enabled={metaContributorTier} onChange={onSetMetaContributorTier} />
      )}
    </div>
  );
}

const OPENROUTER_AUTO_MODEL_ID = 'openrouter/auto';
const MAX_MODEL_PICKER_RESULTS = 40;

/** One row in {@link CatalogModelPicker}, normalised from whichever
 * fetched-catalog vendor is being rendered. */
interface PickerOption {
  id: string;
  name: string;
  /** Optional trailing note on the row, e.g. Bedrock's provider name. */
  hint?: string;
}

/** Search-as-you-type combobox over a fetched model catalog -- OpenRouter's
 * ~414 models (kodo/doc/LLM_REGISTRY.md §3a) or AWS Bedrock's regional
 * catalog (§3b). Either list is pushed whole (hello.ack's
 * `openrouter_catalog`/`bedrock_catalog`) and filtered client-side here, no
 * per-keystroke round trip. Replaces EffortSection's plain <select> for those
 * two vendors, since a several-hundred-option <select> is unusable. */
function CatalogModelPicker({ modelId, options, disabled, placeholderNoun, hasKey, onSelect }: {
  modelId: string;
  options: PickerOption[];
  disabled: boolean;
  /** Plural noun for the empty/placeholder copy, e.g. "models". */
  placeholderNoun: string;
  /** Whether this vendor has at least one API key/credential configured --
   * without one the catalog can never populate, so the empty state should
   * say so rather than claim to still be loading. */
  hasKey: boolean;
  onSelect: (modelId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const blurTimer = useRef<number | undefined>(undefined);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q
      ? options.filter(
          (m) =>
            m.id.toLowerCase().includes(q) ||
            m.name.toLowerCase().includes(q) ||
            (m.hint ?? '').toLowerCase().includes(q),
        )
      : options;
    return matches.slice(0, MAX_MODEL_PICKER_RESULTS);
  }, [query, options]);

  const current = options.find((m) => m.id === modelId) ?? null;

  function pick(id: string) {
    onSelect(id);
    setQuery('');
    setOpen(false);
  }

  return (
    <div className="model-picker">
      <input
        type="text"
        className="model-picker-input"
        disabled={disabled}
        placeholder={
          options.length
            ? `Search ${options.length} ${placeholderNoun}…`
            : hasKey
              ? 'Loading model list…'
              : 'API key is required to load model list'
        }
        value={query}
        onInput={(e) => { setQuery((e.target as HTMLInputElement).value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => { blurTimer.current = window.setTimeout(() => setOpen(false), 150); }}
      />
      {open && !disabled && (
        <div className="model-picker-dropdown">
          {results.length === 0 ? (
            <div className="model-picker-empty">No matching models.</div>
          ) : (
            results.map((m) => (
              <div
                key={m.id}
                className="model-picker-option"
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (blurTimer.current !== undefined) { window.clearTimeout(blurTimer.current); }
                  pick(m.id);
                }}
              >
                <div className="model-picker-option-id">{m.id}</div>
                <div className="model-picker-option-name">{m.hint ? `${m.hint} — ${m.name}` : m.name}</div>
              </div>
            ))
          )}
        </div>
      )}
      {!open && modelId && (
        <div className="model-picker-current">
          Currently: <span className="value-code">{modelId}</span>
          {current && current.name !== modelId && ` — ${current.name}`}
        </div>
      )}
    </div>
  );
}

function OpenRouterEffortSection({ effort, modelId, options, autoMode, uniformEnabled, hasKey, onSelect }: {
  effort: EffortLevel;
  modelId: string | undefined;
  options: PickerOption[];
  autoMode: boolean;
  /** The "use one model for all effort levels" shortcut (see
   *  {@link UniformModelSection}) -- mutually exclusive with `autoMode` at
   *  the UI layer, but both lock this row the same way. */
  uniformEnabled: boolean;
  hasKey: boolean;
  onSelect: (modelId: string) => void;
}) {
  const locked = autoMode || uniformEnabled;
  return (
    <div>
      <div className="effort-title">{EFFORT_LABELS[effort]}</div>
      <div className="effort-example">{EFFORT_EXAMPLES[effort]}</div>
      <CatalogModelPicker
        modelId={modelId || OPENROUTER_AUTO_MODEL_ID}
        options={options}
        disabled={locked}
        placeholderNoun="models"
        hasKey={hasKey}
        onSelect={onSelect}
      />
      {locked && (
        <div className="model-detail">
          <span className="model-recommendation">
            {autoMode
              ? 'Locked to the auto router while Auto mode is on.'
              : 'Locked to the shortcut model while "use one model for all effort levels" is on.'}
          </span>
        </div>
      )}
    </div>
  );
}

/** OpenRouter has no CloudRegistry entry (kodo has no compiled-in model tuple
 * for it -- kodo/doc/LLM_REGISTRY.md §3a), so it needs its own panel rather
 * than CloudVendorPanel's plain-<select> EffortSection, which assumes a
 * short, static per-vendor model list. */
function OpenRouterVendorPanel({
  keys, modelsByVendor, catalog, autoMode, onAddKey, onSetAutoMode, onRefreshCatalog,
  cloudUniform, onSetCloudUniformEnabled, onSetCloudUniformModel,
}: {
  keys: ApiKeyEntry[];
  modelsByVendor: Record<string, string>;
  catalog: OpenRouterModelInfo[];
  autoMode: boolean;
  onAddKey: () => void;
  onSetAutoMode: (enabled: boolean) => void;
  onRefreshCatalog: () => void;
  cloudUniform: CloudUniformEntry;
  onSetCloudUniformEnabled: (enabled: boolean) => void;
  onSetCloudUniformModel: (modelId: string) => void;
}) {
  const vendorMeta = CLOUD_VENDORS.openrouter || { icon: '🔀' };
  const pickerOptions = useMemo(
    () => catalog.map((m) => ({ id: m.id, name: m.name })),
    [catalog],
  );
  return (
    <div>
      <h2>{vendorMeta.icon} OpenRouter LLMs</h2>
      <hr className="section-divider" />
      <p className="intro-text">
        OpenRouter aggregates hundreds of models from many providers behind a single API key. In Auto mode,
        OpenRouter picks a model for every request; switch to Manual mode to choose a specific model for each
        level of effort instead.
      </p>
      <CloudKeysSection vendor="openrouter" vendorLabel="OpenRouter" keys={keys} onAddKey={onAddKey} />
      <hr className="section-divider" />
      <div className="section-heading">Model catalog</div>
      <p className="intro-text">
        {catalog.length
          ? `${catalog.length} models available.`
          : 'Model list not loaded yet — this fills in shortly after the Kōdo server starts.'}
      </p>
      <button className="secondary-btn" onClick={onRefreshCatalog}>Refresh model list</button>
      <hr className="section-divider" />
      <div className="section-heading">Auto mode</div>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={autoMode}
          disabled={cloudUniform.enabled}
          onChange={(e) => onSetAutoMode((e.target as HTMLInputElement).checked)}
        />
        Let OpenRouter automatically pick a model for every effort level
      </label>
      {cloudUniform.enabled && (
        <div className="model-detail">
          <span className="model-recommendation">
            Turn off "use one model for all effort levels" below to use Auto mode instead.
          </span>
        </div>
      )}
      <UniformModelSection
        enabled={cloudUniform.enabled}
        checkboxDisabled={autoMode}
        lockedNote='Turn off Auto mode above to use one specific model for every effort level instead.'
        picker={(
          <CatalogModelPicker
            modelId={cloudUniform.modelId || ''}
            options={pickerOptions}
            disabled={false}
            placeholderNoun="models"
            hasKey={keys.length > 0}
            onSelect={onSetCloudUniformModel}
          />
        )}
        onToggle={onSetCloudUniformEnabled}
      />
      {EFFORT_LEVELS.map((effort) => (
        <div key={effort}>
          <hr className="section-divider" />
          <OpenRouterEffortSection
            effort={effort}
            modelId={modelsByVendor[effort]}
            options={pickerOptions}
            autoMode={autoMode}
            uniformEnabled={cloudUniform.enabled}
            hasKey={keys.length > 0}
            onSelect={(model_id) => vscode.postMessage({ type: 'set_cloud_model', vendor: 'openrouter', effort, model_id })}
          />
        </div>
      ))}
    </div>
  );
}

/** AWS Bedrock's credentials are a **pair** — an IAM access key id and a
 * secret access key — where every other vendor's is a single string. They are
 * still stored and listed through exactly the same named-multi-key mechanism
 * (`cloud-credentials.ts`); only the add form differs, which is why this
 * reuses {@link CloudKeysSection} unchanged and the two-field form lives in
 * `AddKeyModal.tsx`. See kodo/doc/LLM_REGISTRY.md §3b. */
function BedrockCredentialsHelp() {
  return (
    <p className="intro-text">
      Kōdo signs Bedrock requests with a long-term IAM user access key — an access key ID and a secret
      access key, entered together. Create a dedicated IAM user for this, grant it just{' '}
      <span className="value-code">bedrock:InvokeModelWithResponseStream</span>,{' '}
      <span className="value-code">bedrock:ListFoundationModels</span> and{' '}
      <span className="value-code">bedrock:ListInferenceProfiles</span>, and make sure the models you want
      are enabled for your account in the Bedrock console.
    </p>
  );
}

/** Bedrock is regional: which models exist, which cross-region inference
 * profiles can serve them, and what they cost all depend on the region — so
 * changing it also invalidates the fetched model catalog (which is why the
 * host drops and re-fetches it, see `cloud-ai-settings.ts`). */
function BedrockRegionSection({ region, onChange }: {
  region: string;
  onChange: (region: string) => void;
}) {
  const known = BEDROCK_REGIONS.includes(region) ? BEDROCK_REGIONS : [region, ...BEDROCK_REGIONS];
  return (
    <div>
      <div className="section-heading">AWS region</div>
      <p className="intro-text">
        Bedrock is regional — the models available to you, and the cross-region inference profiles that can
        serve them, both depend on this. Changing it reloads the model list below.
      </p>
      <select
        className="settings-select model-select"
        value={region}
        onChange={(e) => onChange((e.target as HTMLSelectElement).value)}
      >
        {known.map((r) => <option key={r} value={r}>{r}</option>)}
      </select>
    </div>
  );
}

function BedrockEffortSection({ effort, modelId, options, disabled, hasKey, onSelect }: {
  effort: EffortLevel;
  modelId: string | undefined;
  options: PickerOption[];
  /** Locked while the "use one model for all effort levels" shortcut is
   *  enabled (see {@link UniformModelSection}) -- Bedrock has no Auto mode
   *  to compete with, so this is the only source of a locked row here. */
  disabled: boolean;
  hasKey: boolean;
  onSelect: (modelId: string) => void;
}) {
  return (
    <div>
      <div className="effort-title">{EFFORT_LABELS[effort]}</div>
      <div className="effort-example">{EFFORT_EXAMPLES[effort]}</div>
      <CatalogModelPicker
        modelId={modelId || ''}
        options={options}
        disabled={disabled}
        placeholderNoun="models and inference profiles"
        hasKey={hasKey}
        onSelect={onSelect}
      />
      {disabled && (
        <div className="model-detail">
          <span className="model-recommendation">Locked to the shortcut model while "use one model for all effort levels" is on.</span>
        </div>
      )}
    </div>
  );
}

/** Bedrock has no CloudRegistry entry either (its catalog is fetched per
 * region, not compiled in — kodo/doc/LLM_REGISTRY.md §3b), so like OpenRouter
 * it needs its own panel rather than CloudVendorPanel's plain-&lt;select&gt;
 * EffortSection. It differs from the OpenRouter panel in three places: the
 * credentials are a key *pair*, there is a region to choose, and there is no
 * Auto mode — Bedrock has no router pseudo-model, so every effort tier names
 * a concrete model or inference profile. */
function BedrockVendorPanel({
  keys, modelsByVendor, catalog, region, onAddKey, onSetRegion, onRefreshCatalog,
  cloudUniform, onSetCloudUniformEnabled, onSetCloudUniformModel,
}: {
  keys: ApiKeyEntry[];
  modelsByVendor: Record<string, string>;
  catalog: BedrockModelInfo[];
  region: string;
  onAddKey: () => void;
  onSetRegion: (region: string) => void;
  onRefreshCatalog: () => void;
  cloudUniform: CloudUniformEntry;
  onSetCloudUniformEnabled: (enabled: boolean) => void;
  onSetCloudUniformModel: (modelId: string) => void;
}) {
  const vendorMeta = CLOUD_VENDORS.bedrock || { icon: '🟧' };
  // Cross-region inference profiles are what most Bedrock models must be
  // called through, so they are labelled as such rather than left looking
  // like duplicate entries.
  const pickerOptions = useMemo(
    () => catalog.map((m) => ({
      id: m.id,
      name: m.inference_profile ? `${m.name} (cross-region profile)` : m.name,
      hint: m.provider,
    })),
    [catalog],
  );
  return (
    <div>
      <h2>{vendorMeta.icon} AWS Bedrock LLMs</h2>
      <hr className="section-divider" />
      <p className="intro-text">
        Bedrock serves models from many providers through your own AWS account, billed to AWS rather than to
        each vendor separately. Pick a region, then assign one of its models — or a cross-region inference
        profile — to each level of effort.
      </p>
      <BedrockCredentialsHelp />
      <CloudKeysSection vendor="bedrock" vendorLabel="AWS Bedrock" keys={keys} onAddKey={onAddKey} />
      <hr className="section-divider" />
      <BedrockRegionSection region={region} onChange={onSetRegion} />
      <hr className="section-divider" />
      <div className="section-heading">Model catalog</div>
      <p className="intro-text">
        {catalog.length
          ? `${catalog.length} models and inference profiles available in ${region}.`
          : `Model list not loaded for ${region} yet — add an access key above, then refresh. Kōdo fetches the list from your own AWS account.`}
      </p>
      <button className="secondary-btn" onClick={onRefreshCatalog}>Refresh model list</button>
      <UniformModelSection
        enabled={cloudUniform.enabled}
        checkboxDisabled={false}
        picker={(
          <CatalogModelPicker
            modelId={cloudUniform.modelId || ''}
            options={pickerOptions}
            disabled={false}
            placeholderNoun="models and inference profiles"
            hasKey={keys.length > 0}
            onSelect={onSetCloudUniformModel}
          />
        )}
        onToggle={onSetCloudUniformEnabled}
      />
      {EFFORT_LEVELS.map((effort) => (
        <div key={effort}>
          <hr className="section-divider" />
          <BedrockEffortSection
            effort={effort}
            modelId={modelsByVendor[effort]}
            options={pickerOptions}
            disabled={cloudUniform.enabled}
            hasKey={keys.length > 0}
            onSelect={(model_id) => vscode.postMessage({ type: 'set_cloud_model', vendor: 'bedrock', effort, model_id })}
          />
        </div>
      ))}
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
  openRouterCatalog: OpenRouterModelInfo[];
  openRouterAutoMode: boolean;
  onSetOpenRouterAutoMode: (enabled: boolean) => void;
  onRefreshOpenRouterCatalog: () => void;
  bedrockCatalog: BedrockModelInfo[];
  bedrockRegion: string;
  onSetBedrockRegion: (region: string) => void;
  onRefreshBedrockCatalog: () => void;
  /** vendor -> its "use one model for all effort levels" shortcut state
   *  (kodo/doc/SETTINGS.md's `models.cloud_uniform`). */
  cloudUniform: Record<string, CloudUniformEntry>;
  onSetCloudUniformEnabled: (vendor: string, enabled: boolean) => void;
  onSetCloudUniformModel: (vendor: string, modelId: string) => void;
}

const EMPTY_CLOUD_UNIFORM: CloudUniformEntry = { enabled: false, modelId: null };

export function CloudVendorSection({
  vendor, cloudRegistry, modelsByVendor, keysByVendor, onAddKey, metaContributorTier, onSetMetaContributorTier,
  openRouterCatalog, openRouterAutoMode, onSetOpenRouterAutoMode, onRefreshOpenRouterCatalog,
  bedrockCatalog, bedrockRegion, onSetBedrockRegion, onRefreshBedrockCatalog,
  cloudUniform, onSetCloudUniformEnabled, onSetCloudUniformModel,
}: CloudVendorSectionProps) {
  const uniform = cloudUniform[vendor] ?? EMPTY_CLOUD_UNIFORM;
  // OpenRouter deliberately has no cloudRegistry entry (no compiled-in model
  // tuple -- kodo/doc/LLM_REGISTRY.md §3a), so it must be checked before the
  // registry lookup below, or it would incorrectly fall through to
  // CloudComingSoon.
  if (vendor === 'openrouter') {
    return (
      <OpenRouterVendorPanel
        keys={keysByVendor.openrouter || []}
        modelsByVendor={modelsByVendor.openrouter || {}}
        catalog={openRouterCatalog}
        autoMode={openRouterAutoMode}
        onAddKey={() => onAddKey('openrouter')}
        onSetAutoMode={onSetOpenRouterAutoMode}
        onRefreshCatalog={onRefreshOpenRouterCatalog}
        cloudUniform={uniform}
        onSetCloudUniformEnabled={(enabled) => onSetCloudUniformEnabled('openrouter', enabled)}
        onSetCloudUniformModel={(modelId) => onSetCloudUniformModel('openrouter', modelId)}
      />
    );
  }
  // Bedrock has no cloudRegistry entry either, for the same reason -- see
  // BedrockVendorPanel.
  if (vendor === 'bedrock') {
    return (
      <BedrockVendorPanel
        keys={keysByVendor.bedrock || []}
        modelsByVendor={modelsByVendor.bedrock || {}}
        catalog={bedrockCatalog}
        region={bedrockRegion}
        onAddKey={() => onAddKey('bedrock')}
        onSetRegion={onSetBedrockRegion}
        onRefreshCatalog={onRefreshBedrockCatalog}
        cloudUniform={uniform}
        onSetCloudUniformEnabled={(enabled) => onSetCloudUniformEnabled('bedrock', enabled)}
        onSetCloudUniformModel={(modelId) => onSetCloudUniformModel('bedrock', modelId)}
      />
    );
  }
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
      cloudUniform={uniform}
      onSetCloudUniformEnabled={(enabled) => onSetCloudUniformEnabled(vendor, enabled)}
      onSetCloudUniformModel={(modelId) => onSetCloudUniformModel(vendor, modelId)}
    />
  );
}
