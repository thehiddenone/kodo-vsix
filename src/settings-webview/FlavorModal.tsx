/**
 * Manage-flavors modal: a list-detail layout — the left pane lists every
 * flavor for the entry the button was opened from; selecting one populates
 * the right pane's form. `selectedFlavorId === null` means "add new" mode
 * (the form is blank and Submit creates a brand-new flavor); otherwise
 * Submit updates the selected *custom* flavor in place. Predefined flavors
 * are strictly read-only (kodo/doc/LLM_REGISTRY.md §4.6) — selecting one
 * fills the form for reference (fields become readonly, so their text stays
 * selectable/copyable into a new flavor) but disables Submit and Remove; the
 * server independently rejects update_flavor/remove_flavor for a predefined
 * flavor_id regardless of this client-side gate.
 */

import { useEffect, useState } from 'preact/hooks';
import { FLAVOR_PLATFORM_OPTIONS, flavorPlatformBadge, llamaArgsToText, parseNonNegativeInt } from './localLlmUtils';
import type { LlamaFlavorPlatform, LocalFlavor, LocalRegistryEntry } from './types';
import { vscode } from './vscode';

interface FlavorModalProps {
  entry: LocalRegistryEntry;
  onClose: () => void;
}

export function FlavorModal({ entry, onClose }: FlavorModalProps) {
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

  // Excludes the flavor currently being edited, so re-submitting a flavor
  // under its own unchanged name isn't flagged as a clash with itself.
  const trimmedName = name.trim();
  const nameDup = Boolean(trimmedName) && flavors.some((f) => f.id !== selectedFlavorId && f.name === trimmedName);
  const canSubmit = !readOnly && Boolean(trimmedName) && !nameDup;

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
      // Stays open in "add another" mode — the freshly-added flavor shows up
      // in the left pane once the next registry_state arrives.
      setName('');
      setDescription('');
      setLlamaArgsText('');
      setMinRam('');
      setMinVram('');
      setPlatform('both');
    }
  }

  const activeId = entry.active_flavor || flavors[0]?.id || '';

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
              <button className="secondary-btn" type="button" onClick={() => setSelectedFlavorId(null)}>Add</button>
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
              <button id="flavor-submit-btn" disabled={!canSubmit} onClick={submit}>Submit</button>
              <button className="secondary-btn" onClick={onClose}>Close</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
