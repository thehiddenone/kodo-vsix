/**
 * Manage-flavors modal: a list-detail layout — the left pane lists every
 * flavor for the entry the button was opened from; selecting one populates
 * the right pane's form and Submit updates that *custom* flavor in place.
 * Predefined flavors are strictly read-only (kodo/doc/LLM_REGISTRY.md §4.6)
 * — selecting one fills the form for reference (fields become readonly, so
 * their text stays selectable/copyable into a new flavor) but disables
 * Submit and Remove; the server independently rejects
 * update_flavor/remove_flavor for a predefined flavor_id regardless of this
 * client-side gate.
 *
 * "Add" does not open a blank form to fill in by hand — it creates a real
 * flavor immediately (`addFlavor`, below): a unique "New flavor" name
 * (appending " 2", " 3", … against existing flavor names), description
 * "Custom flavor", and `llama_args` copied from the entry's `"default"`-id
 * flavor — the built-in default every flavor-capable entry ships or is
 * seeded with (kodo/doc/LLM_REGISTRY.md's `_seed_default_flavor`/
 * `LlamaFlavor.make_default_kv_q8`) — or left empty if that flavor doesn't
 * exist (e.g. a custom entry whose seeded `"default"` was since removed).
 * `selectedFlavorId` briefly goes to `null` (blank form) while the create
 * round-trips to the server, then flips to the new flavor's server-assigned
 * id once it appears in the next registry_state push, selecting it for
 * further editing. `selectedFlavorId === null` otherwise only happens when
 * the entry has no flavors left at all to select.
 *
 * Submit is also disabled while any sampling shortcut field has an issue
 * (`samplingInvalid`, from `samplingFieldIssue` — an unknown `samplers` name,
 * unparseable text, or a value outside its recommended band; kodo/doc/
 * SAMPLING.md §8d/§8e), same yellow ⚠ and same gating rule as the session
 * sampling modal's Apply button. Unlike that modal, a value here writes
 * straight into `llama_args` on every keystroke regardless (there is no
 * separate "apply" step for a single field) — the gate only stops the whole
 * *form* from being submitted with a bad value sitting in it.
 */

import { useEffect, useState } from 'preact/hooks';
import {
  applySamplingFieldToLlamaArgsText,
  deriveSamplingTextFromLlamaArgsText,
  FLAVOR_PLATFORM_OPTIONS,
  flavorPlatformBadge,
  llamaArgsToText,
  parseNonNegativeInt,
  samplingFieldIssue,
  samplingLabelText,
} from './localLlmUtils';
import type { LlamaFlavorPlatform, LocalFlavor, LocalRegistryEntry, SamplingParamSpec } from './types';
import { vscode } from './vscode';

interface FlavorModalProps {
  entry: LocalRegistryEntry;
  /** The server's request-level sampling parameter table (`sampling_specs`,
   *  kodo/doc/SAMPLING.md). `[]` before the first registry payload lands,
   *  which simply hides the sampling shortcuts section. Only specs with at
   *  least one CLI flag are offered here — `min_keep` has none and is
   *  session-override only. */
  samplingSpecs: SamplingParamSpec[];
  onClose: () => void;
}

export function FlavorModal({ entry, samplingSpecs, onClose }: FlavorModalProps) {
  // `min_keep` has no CLI flag and can't be written into `llama_args` — it's
  // session-override only, so it's excluded from this shortcut form.
  const flavorSamplingSpecs = samplingSpecs.filter((s) => s.cli_flags.length > 0);
  const flavors = entry.flavors || [];
  const [selectedFlavorId, setSelectedFlavorId] = useState<string | null>(
    entry.active_flavor || flavors[0]?.id || null,
  );
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [llamaArgsText, setLlamaArgsText] = useState('');
  const [minRam, setMinRam] = useState('');
  const [minVram, setMinVram] = useState('');
  const [platform, setPlatform] = useState<LlamaFlavorPlatform>('both');
  const [showAdvancedSampling, setShowAdvancedSampling] = useState(false);
  // Name of a flavor just created via `addFlavor`, waiting for its
  // server-assigned id to show up in `flavors` so it can be selected — see
  // the effect below and the file-level doc comment.
  const [pendingNewFlavorName, setPendingNewFlavorName] = useState<string | null>(null);

  const selected = flavors.find((f) => f.id === selectedFlavorId) || null;
  const readOnly = Boolean(selected?.predefined);

  // Re-sync the form ONLY when the selection itself changes — deliberately
  // NOT keyed on the selected flavor's field values. `KodoSettingsPanel`
  // pushes its ENTIRE state on every update (a download-progress tick, an
  // unrelated llamaCpp.busy flip, …), which re-serializes `localRegistry`
  // and hands this component a new `llama_args` object identity even when
  // its content is unchanged — keying the effect on those values would
  // reset the form (clobbering an in-progress edit) on every unrelated
  // background push. The original's `refreshFlavorModalIfOpen` had the same
  // care: it only ever called `renderFlavorList()` (never re-populated the
  // form) when the current selection still existed.
  useEffect(() => {
    if (selected) {
      setName(selected.name);
      setDescription(selected.description || '');
      setLlamaArgsText(llamaArgsToText(selected.llama_args));
      setMinRam(selected.min_ram ? String(selected.min_ram) : '');
      setMinVram(selected.min_vram ? String(selected.min_vram) : '');
      setPlatform(selected.platform || 'both');
    } else {
      setName('');
      setDescription('');
      setLlamaArgsText('');
      setMinRam('');
      setMinVram('');
      setPlatform('both');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFlavorId]);

  // The selection may have vanished (e.g. removed elsewhere) — fall back to
  // the first flavor, mirroring the original's `refreshFlavorModalIfOpen`.
  useEffect(() => {
    if (selectedFlavorId && !flavors.some((f) => f.id === selectedFlavorId)) {
      setSelectedFlavorId(flavors[0]?.id || null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flavors]);

  // Selects the flavor `addFlavor` just created once it shows up in this
  // registry_state push — its id is server-assigned (slugified from the
  // name, de-duplicated), so it isn't known until this round-trips back.
  useEffect(() => {
    if (!pendingNewFlavorName) { return; }
    const created = flavors.find((f) => f.name === pendingNewFlavorName);
    if (created) {
      setSelectedFlavorId(created.id);
      setPendingNewFlavorName(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flavors, pendingNewFlavorName]);

  // Excludes the flavor currently being edited, so re-submitting a flavor
  // under its own unchanged name isn't flagged as a clash with itself.
  const trimmedName = name.trim();
  const nameDup = Boolean(trimmedName) && flavors.some((f) => f.id !== selectedFlavorId && f.name === trimmedName);
  // Derived straight from the current (possibly half-edited) llama_args
  // textarea contents — there is no separate stored sampling value, so this
  // and the textarea can never disagree.
  const samplingText = deriveSamplingTextFromLlamaArgsText(llamaArgsText, flavorSamplingSpecs);
  const samplingInvalid = flavorSamplingSpecs.some(
    (spec) => samplingFieldIssue(spec, samplingText[spec.name] ?? '') !== null,
  );
  const canSubmit = !readOnly && Boolean(trimmedName) && !nameDup && !samplingInvalid;

  function submit() {
    if (!canSubmit) { return; }
    if (selectedFlavorId) {
      vscode.postMessage({
        type: 'update_flavor',
        name: entry.name,
        flavor_id: selectedFlavorId,
        flavor_name: trimmedName,
        description: description.trim(),
        llama_args_text: llamaArgsText,
        min_ram: parseNonNegativeInt(minRam),
        min_vram: parseNonNegativeInt(minVram),
        platform,
      });
    } else {
      vscode.postMessage({
        type: 'add_flavor',
        name: entry.name,
        flavor_name: trimmedName,
        description: description.trim(),
        llama_args_text: llamaArgsText,
        min_ram: parseNonNegativeInt(minRam),
        min_vram: parseNonNegativeInt(minVram),
        platform,
      });
      // Only reachable with `selectedFlavorId === null` and a hand-filled
      // form — normally just the entry-has-zero-flavors case, since `Add`
      // itself now creates flavors directly (`addFlavor`, below) rather
      // than leaving the form open for manual entry. Stays open in "add
      // another" mode — the freshly-added flavor shows up in the left pane
      // once the next registry_state arrives.
      setName('');
      setDescription('');
      setLlamaArgsText('');
      setMinRam('');
      setMinVram('');
      setPlatform('both');
    }
  }

  // Creates a new custom flavor immediately, without requiring the user to
  // fill in and submit a form first — see the file-level doc comment for
  // the exact defaults and the "default"-id flavor this copies llama_args
  // from.
  function addFlavor() {
    const existingNames = new Set(flavors.map((f) => f.name));
    let newName = 'New flavor';
    let suffix = 2;
    while (existingNames.has(newName)) {
      newName = `New flavor ${suffix}`;
      suffix += 1;
    }
    const defaultFlavor = flavors.find((f) => f.id === 'default') || null;
    setSelectedFlavorId(null);
    setPendingNewFlavorName(newName);
    vscode.postMessage({
      type: 'add_flavor',
      name: entry.name,
      flavor_name: newName,
      description: 'Custom flavor',
      llama_args_text: defaultFlavor ? llamaArgsToText(defaultFlavor.llama_args) : '',
      min_ram: 0,
      min_vram: 0,
      platform: 'both',
    });
  }

  const activeId = entry.active_flavor || flavors[0]?.id || '';

  const curatedSpecs = flavorSamplingSpecs.filter((s) => !s.advanced);
  const advancedSpecs = flavorSamplingSpecs.filter((s) => s.advanced);

  function samplingField(spec: SamplingParamSpec) {
    const fieldText = samplingText[spec.name] ?? '';
    // A hard error (unknown sampler name, unparseable number) or an
    // out-of-band value (kodo/doc/SAMPLING.md §8d/§8e) — both render as the
    // same yellow ⚠, the tooltip says which, and both disable Submit
    // (`samplingInvalid`, above) so a bad value can't be written into
    // `llama_args` in the first place.
    const issue = samplingFieldIssue(spec, fieldText);
    const label = (
      <label key={`${spec.name}-label`} for={`flavor-sampling-${spec.name}`} title={spec.help}>
        {/* Always mounted — visibility (not presence) toggles, so the label
            text never shifts as `issue` flips while typing. */}
        <span
          className="sampling-warn"
          style={{ visibility: issue !== null ? 'visible' : 'hidden' }}
          title={issue ?? undefined}
          role={issue !== null ? 'img' : undefined}
          aria-hidden={issue === null}
          aria-label={issue ?? undefined}
        >⚠</span>
        {samplingLabelText(spec)}
      </label>
    );
    const input = (
      <input
        key={spec.name}
        id={`flavor-sampling-${spec.name}`}
        type={spec.kind === 'str_list' ? 'text' : 'number'}
        min={spec.minimum ?? undefined}
        max={spec.maximum ?? undefined}
        step={spec.step ?? undefined}
        autocomplete="off"
        title={spec.help}
        placeholder="unset"
        readOnly={readOnly}
        value={fieldText}
        onInput={(e) =>
          setLlamaArgsText(
            applySamplingFieldToLlamaArgsText(llamaArgsText, spec, (e.target as HTMLInputElement).value),
          )
        }
      />
    );
    // "Sampler order" (`samplers`) holds a long comma-separated list of
    // sampler names — give it its own full-width row with a 30/60 label/input
    // split instead of the grid's shared 92px input column, which is sized
    // for the short numeric fields. Mirrors samplingOrderLabel/
    // samplingOrderInput in the session sampling modal (src/webview/styles.ts).
    if (spec.name === 'samplers') {
      return (
        <div key={`${spec.name}-row`} className="sampling-order-row">
          {label}
          {input}
        </div>
      );
    }
    return (
      <>
        {label}
        {input}
      </>
    );
  }

  return (
    <div className="li-modal-overlay open" onClick={(e) => { if (e.target === e.currentTarget) { onClose(); } }}>
      <div className="modal-dialog flavor-modal-dialog" role="dialog" aria-modal="true">
        <h3>Manage flavors — {entry.description || entry.name}</h3>
        <p className="explain">
          A flavor is a named set of llama.cpp launch arguments for this LLM — e.g. a larger context window or
          GPU-offload tuning for a smaller card. Only one flavor is active at a time, and switching to a
          different one fully replaces the previous flavor&apos;s arguments. Pick which flavor is active from the
          sidebar.
        </p>
        <div className="flavor-modal-body">
          <div className="flavor-list-pane">
            <div className="flavor-list">
              {flavors.map((f: LocalFlavor) => (
                <div
                  key={f.id}
                  className={'flavor-list-row' + (f.id === selectedFlavorId ? ' selected' : '')}
                  onClick={() => setSelectedFlavorId(f.id)}
                >
                  <div className="flavor-row-name">
                    {f.name}{f.id === activeId ? ' (active)' : ''}{f.predefined ? ' — built-in' : ''}
                    {flavorPlatformBadge(f.platform) ? ` — ${flavorPlatformBadge(f.platform)}` : ''}
                  </div>
                  {f.description && <div className="flavor-row-desc">{f.description}</div>}
                </div>
              ))}
            </div>
            <div className="flavor-list-actions">
              <button className="secondary-btn" type="button" onClick={addFlavor}>Add</button>
              <button
                className="secondary-btn"
                type="button"
                disabled={!selected || selected.predefined}
                onClick={() => {
                  if (!selected || selected.predefined) { return; }
                  vscode.postMessage({ type: 'remove_flavor', name: entry.name, flavor_id: selected.id });
                }}
              >
                Remove
              </button>
            </div>
          </div>
          <div className="flavor-form-pane">
            <div className="modal-field">
              <label for="flavor-name">Name</label>
              <input
                type="text"
                id="flavor-name"
                autocomplete="off"
                readOnly={readOnly}
                value={name}
                onInput={(e) => setName((e.target as HTMLInputElement).value)}
              />
              <div className="field-error">{nameDup ? `A flavor named "${trimmedName}" already exists for this LLM.` : ''}</div>
            </div>
            <div className="modal-field">
              <label for="flavor-description">Description (optional)</label>
              <input
                type="text"
                id="flavor-description"
                autocomplete="off"
                readOnly={readOnly}
                value={description}
                onInput={(e) => setDescription((e.target as HTMLInputElement).value)}
              />
            </div>
            <div className="modal-field">
              <label for="flavor-llama-args">llama.cpp arguments (optional)</label>
              <textarea
                id="flavor-llama-args"
                rows={8}
                readOnly={readOnly}
                placeholder={'--ctx-size 1048576\n--rope-scaling yarn\n--rope-scale 4'}
                value={llamaArgsText}
                onInput={(e) => setLlamaArgsText((e.target as HTMLTextAreaElement).value)}
              />
              <div className="field-hint">
                One flag per line. Fully replaces the previously active flavor&apos;s arguments once this one is
                selected.
              </div>
            </div>
            <hr className="section-divider" />
            {flavorSamplingSpecs.length > 0 && (
              <>
                <div className="field-hint">
                  Sampling shortcuts — a friendlier way to set the launch arguments above for common sampling
                  knobs (temperature, top-k, …). Editing a field here writes straight into the arguments text,
                  and vice versa; the two are always in sync, so changes here need a llama-server restart just
                  like anything else in that box. Leave a field blank to not set it at all. A ⚠ next to a field
                  means the value is outside the range normally worth using, or isn&apos;t valid at all — hover it
                  for details; fix or clear it to re-enable Submit. These can still be fine-tuned per session,
                  live and without a restart, from the ⚙ button in the chat footer.
                </div>
                <div className="sampling-grid">
                  {curatedSpecs.map((spec) => samplingField(spec))}
                </div>
                <button
                  className="sampling-advanced-toggle"
                  type="button"
                  onClick={() => setShowAdvancedSampling((v) => !v)}
                >
                  {showAdvancedSampling ? '▼' : '▶'} Advanced sampling ({advancedSpecs.length})
                </button>
                {showAdvancedSampling && (
                  <div className="sampling-grid">
                    {advancedSpecs.map((spec) => samplingField(spec))}
                  </div>
                )}
                <hr className="section-divider" />
              </>
            )}
            <div className="field-hint">
              System RAM (or Apple Silicon unified memory) and discrete GPU VRAM this flavor needs to run — leave
              blank/0 if unknown. Selecting a flavor whose requirement exceeds this machine&apos;s detected
              hardware prompts for confirmation first.
            </div>
            <div className="modal-field-row">
              <div className="modal-field">
                <label for="flavor-min-ram">Minimum RAM (GB, optional)</label>
                <input
                  type="number"
                  id="flavor-min-ram"
                  min="0"
                  step="1"
                  readOnly={readOnly}
                  value={minRam}
                  onInput={(e) => setMinRam((e.target as HTMLInputElement).value)}
                />
              </div>
              <div className="modal-field">
                <label for="flavor-min-vram">Minimum VRAM (GB, optional)</label>
                <input
                  type="number"
                  id="flavor-min-vram"
                  min="0"
                  step="1"
                  readOnly={readOnly}
                  value={minVram}
                  onInput={(e) => setMinVram((e.target as HTMLInputElement).value)}
                />
              </div>
            </div>
            <hr className="section-divider" />
            <div className="modal-field">
              <label for="flavor-platform">Platform compatibility</label>
              <select
                id="flavor-platform"
                className="settings-select"
                disabled={readOnly}
                value={platform}
                onChange={(e) => setPlatform((e.target as HTMLSelectElement).value as LlamaFlavorPlatform)}
              >
                {FLAVOR_PLATFORM_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <div className="field-hint">
                Which host(s) this flavor may be launched on. Restrict it if the launch args only make sense on
                one platform (e.g. a huge context flavor that only fits Apple Silicon&apos;s unified memory) —
                kodo skips an incompatible flavor when auto-selecting a default.
              </div>
            </div>
            <hr className="section-divider" />
            <div className={'field-hint' + (readOnly ? ' visible' : '')} id="flavor-readonly-hint">
              This is a built-in flavor and cannot be edited or removed. Copy its values into a new flavor with
              &quot;Add&quot; if you want to customize it.
            </div>
            <div className="modal-actions">
              <button
                id="flavor-submit-btn"
                disabled={!canSubmit}
                title={samplingInvalid ? 'Fix the sampling parameter(s) marked ⚠ before submitting' : undefined}
                onClick={submit}
              >
                Submit
              </button>
              <button className="secondary-btn" onClick={onClose}>Close</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
