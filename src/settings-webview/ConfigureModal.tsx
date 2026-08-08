/**
 * Configure modal — the **Default profile**'s knobs for one local LLM
 * (kodo/doc/LLM_REGISTRY.md §4.6).
 *
 * A knob is a hardcoded checkbox / dropdown / number control that owns a fixed
 * set of llama-server CLI flags. This modal renders one control per knob the
 * entry offers, each with its description and the exact flags the current
 * state produces, then sends the whole selection at once on Apply
 * (`set_knobs` → `local_llm.set_knobs`). Bulk rather than per-knob on purpose:
 * the server replaces the entry's entire selection, so a modal opened before
 * another window changed something cannot resurrect half the old state.
 *
 * Only the Default profile has knobs — a user-defined profile is a raw arg set
 * with nothing to configure here, which is why the sidebar hides its Configure
 * button whenever one is selected and why this modal never mentions them.
 *
 * Local edits are held in `selections` and are **not** applied until Apply;
 * Cancel discards them. That is the one place this modal deliberately differs
 * from the profile editor, where a field writes through immediately: a knob
 * change restarts llama-server when this entry is the running model, so
 * "change three knobs, restart once" has to be possible.
 *
 * Knobs are split into normal and Advanced, the latter behind a collapsible
 * section that is collapsed every time the modal opens.
 */

import { useEffect, useState } from 'preact/hooks';
import { formatLlamaArgs, knobLlamaArgs, knobSelection } from './localLlmUtils';
import type { KnobDef, KnobDefs, LocalRegistryEntry } from './types';
import { vscode } from './vscode';

interface ConfigureModalProps {
  entry: LocalRegistryEntry;
  /** Every knob definition the server ships, keyed by id — `entry.knobs` holds
   *  the ids this entry offers, in display order. Definitions are shipped once
   *  centrally rather than per entry (kodo/doc/LLM_REGISTRY.md §4.6). */
  knobDefs: KnobDefs;
  onClose: () => void;
}

export function ConfigureModal({ entry, knobDefs, onClose }: ConfigureModalProps) {
  // A knob id with no definition in `knob_defs` can only mean a payload from a
  // newer/older server than this webview bundle — skip it rather than render a
  // control with no options.
  const knobs: KnobDef[] = (entry.knobs || [])
    .map((id) => knobDefs[id])
    .filter((k): k is KnobDef => Boolean(k));

  const [selections, setSelections] = useState<Record<string, string>>(entry.knob_selections || {});
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Re-seed only when the modal is pointed at a different LLM — deliberately
  // NOT keyed on `entry.knob_selections`. `KodoSettingsPanel` pushes its ENTIRE
  // state on every update (a download-progress tick, an unrelated llamaCpp.busy
  // flip, …), handing this component a new object identity even when the
  // content is unchanged; keying on it would discard an in-progress edit on
  // every unrelated background push. Same care FlavorModal took before it.
  useEffect(() => {
    setSelections(entry.knob_selections || {});
    setShowAdvanced(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.name]);

  const dirty = knobs.some(
    (knob) => knobSelection(knob, selections) !== knobSelection(knob, entry.knob_selections || {}),
  );

  function apply() {
    const payload: Record<string, string> = {};
    for (const knob of knobs) {
      payload[knob.id] = knobSelection(knob, selections);
    }
    vscode.postMessage({ type: 'set_knobs', name: entry.name, knobs: payload });
    onClose();
  }

  function control(knob: KnobDef) {
    const value = knobSelection(knob, selections);
    const set = (next: string) => setSelections((prev) => ({ ...prev, [knob.id]: next }));

    if (knob.kind === 'number') {
      return (
        <input
          type="number"
          id={`knob-${knob.id}`}
          className="knob-number"
          min={knob.minimum ?? undefined}
          max={knob.maximum ?? undefined}
          step={knob.step ?? undefined}
          autocomplete="off"
          placeholder={knob.unset_label || 'unset'}
          value={value}
          onInput={(e) => set((e.target as HTMLInputElement).value)}
        />
      );
    }
    if (knob.kind === 'checkbox') {
      return (
        <label className="knob-checkbox-label">
          <input
            type="checkbox"
            id={`knob-${knob.id}`}
            checked={value === 'on'}
            onChange={(e) => set((e.target as HTMLInputElement).checked ? 'on' : 'off')}
          />
          {(knob.options || []).find((o) => o.id === (value === 'on' ? 'on' : 'off'))?.name ?? ''}
        </label>
      );
    }
    return (
      <select
        id={`knob-${knob.id}`}
        className="settings-select"
        value={value}
        onChange={(e) => set((e.target as HTMLSelectElement).value)}
      >
        {(knob.options || []).map((option) => (
          <option key={option.id} value={option.id}>{option.name}</option>
        ))}
      </select>
    );
  }

  function knobRow(knob: KnobDef) {
    const value = knobSelection(knob, selections);
    // The description of the *selected* state, where there is one — a dropdown
    // option's own text is what explains that choice, and repeating every
    // option's paragraph in the modal would drown the controls.
    const optionDescription =
      knob.kind === 'number' ? '' : (knob.options || []).find((o) => o.id === value)?.description || '';
    const args = formatLlamaArgs(knobLlamaArgs(knob, value));
    return (
      <div className="knob-row" key={knob.id}>
        <div className="knob-head">
          <label for={`knob-${knob.id}`} className="knob-name">{knob.name}</label>
          {control(knob)}
        </div>
        {knob.description && <div className="knob-desc">{knob.description}</div>}
        {optionDescription && <div className="knob-desc knob-option-desc">{optionDescription}</div>}
        <div className="knob-args">
          {args ? <code>{args}</code> : <span className="knob-args-none">adds no launch arguments</span>}
        </div>
      </div>
    );
  }

  const normal = knobs.filter((k) => !k.advanced);
  const advanced = knobs.filter((k) => k.advanced);

  return (
    <div className="li-modal-overlay open" onClick={(e) => { if (e.target === e.currentTarget) { onClose(); } }}>
      <div className="modal-dialog configure-modal-dialog" role="dialog" aria-modal="true">
        <h3>Configure — {entry.description || entry.name}</h3>
        <p className="explain">
          These settings build this LLM&apos;s <strong>Default profile</strong>: each control below owns a group of
          llama.cpp launch arguments, and the ones it contributes are listed under it. Changes apply when you press
          Apply, and restart llama-server if this LLM is the one currently running. For launch arguments not covered
          here, create your own profile under &quot;Manage profiles&quot;.
        </p>
        <div className="configure-body">
          {knobs.length === 0 && (
            <div className="field-hint">This LLM has no configurable settings.</div>
          )}
          {normal.map((knob) => knobRow(knob))}
          {advanced.length > 0 && (
            <>
              <hr className="section-divider" />
              <button
                className="sampling-advanced-toggle"
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
              >
                {showAdvanced ? '▼' : '▶'} Advanced ({advanced.length})
              </button>
              {showAdvanced && advanced.map((knob) => knobRow(knob))}
            </>
          )}
        </div>
        <div className="modal-actions">
          <button disabled={!dirty} onClick={apply}>Apply</button>
          <button className="secondary-btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
