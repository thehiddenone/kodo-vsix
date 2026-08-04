/**
 * Request-level sampling parameters for the session's active local quant
 * (kodo/doc/SAMPLING.md) — opened from the ⚙ button in the chat footer,
 * between attach and stop.
 *
 * Every field is optional and starts blank. **Blank means the parameter is not
 * sent to llama-server at all**, which is not the same as sending llama.cpp's
 * built-in default: an omitted field inherits whatever the flavor's CLI
 * `llama_args` launched the server with (SAMPLING.md §1). That is why clearing
 * a field is a real operation with its own button, and why a field's
 * placeholder names what it would inherit rather than showing a number the
 * user never chose.
 *
 * Two things are visible here:
 *  - what the active flavor's `llama_args` actually launched llama-server
 *    with (`defaults`, parsed out of those launch args — a flavor has no
 *    separate sampling state of its own, SAMPLING.md §9), shown as the
 *    inherited value in each field's placeholder, and
 *  - this session's own *overrides* (`values`), which are what the inputs edit
 *    and the only thing here that is genuinely request-level and hot (no
 *    llama-server restart).
 *
 * Nothing is rendered from a hardcoded parameter list: the field set, bounds,
 * grouping and help text all come from `specs`, which the server pushes
 * (`sampling_specs`). A llama.cpp that gains a knob needs no change here.
 *
 * Edits are local until Apply, which posts the COMPLETE set (a full replace,
 * not a patch — a cleared parameter has to disappear). The server validates,
 * may drop or clamp individual values, and echoes back what actually stuck via
 * a `state` event, so `values` is never optimistically updated in place.
 */

import { useEffect, useState } from 'preact/hooks';
import type { SamplingParamSpec, SamplingValues } from '../llm-registry-types';
import { samplingTextToValue, samplingValueToText } from '../llm-registry-types';
import { styles } from './styles';

interface SamplingModalProps {
  /** Active local quant these parameters apply to — shown in the title. */
  model: string;
  specs: SamplingParamSpec[];
  defaults: SamplingValues;
  values: SamplingValues;
  onApply: (values: SamplingValues) => void;
  onClose: () => void;
}

/** What a blank field falls back to, for the placeholder. */
function inheritedText(spec: SamplingParamSpec, defaults: SamplingValues): string {
  const fallback = defaults[spec.name];
  return fallback === undefined
    ? 'server default'
    : `flavor default: ${samplingValueToText(fallback)}`;
}

export function SamplingModal({ model, specs, defaults, values, onApply, onClose }: SamplingModalProps) {
  // Text-keyed rather than value-keyed so a half-typed "0." or "-" survives
  // keystrokes; parsed back to numbers only on Apply.
  const [text, setText] = useState<Record<string, string>>({});
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Re-seed only when the target quant or the server's stored set changes —
  // NOT on every prop identity change. `sampling_state` is re-pushed on each
  // webview rehydrate and on any registry/flavor edit, so keying this on the
  // object identity would wipe an in-progress edit on unrelated background
  // activity (the same hazard FlavorModal's effect documents).
  const valuesKey = JSON.stringify(values);
  useEffect(() => {
    const seeded: Record<string, string> = {};
    for (const spec of specs) {
      seeded[spec.name] = samplingValueToText(values[spec.name]);
    }
    setText(seeded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, valuesKey]);

  function apply() {
    const next: SamplingValues = {};
    for (const spec of specs) {
      const parsed = samplingTextToValue(spec, text[spec.name] ?? '');
      if (parsed !== undefined) {
        next[spec.name] = parsed;
      }
    }
    onApply(next);
    onClose();
  }

  /** Clear every field — the session stops overriding anything and falls back
   *  to the flavor's defaults (and, for what those don't set, the launch args). */
  function clearAll() {
    setText(Object.fromEntries(specs.map((s) => [s.name, ''])));
  }

  const curated = specs.filter((s) => !s.advanced);
  const advanced = specs.filter((s) => s.advanced);
  const overriddenCount = specs.filter((s) => (text[s.name] ?? '').trim() !== '').length;

  function field(spec: SamplingParamSpec) {
    const current = text[spec.name] ?? '';
    return (
      <div key={spec.name} style={styles.samplingField}>
        <div style={styles.samplingFieldRow}>
          <label style={styles.samplingLabel} for={`sampling-${spec.name}`}>
            {spec.label}
            {spec.neutral ? ` (off: ${spec.neutral})` : ''}
          </label>
          <input
            id={`sampling-${spec.name}`}
            style={styles.samplingInput}
            type={spec.kind === 'str_list' ? 'text' : 'number'}
            min={spec.minimum ?? undefined}
            max={spec.maximum ?? undefined}
            step={spec.step ?? undefined}
            autocomplete="off"
            placeholder={inheritedText(spec, defaults)}
            value={current}
            onInput={(e) =>
              setText((prev) => ({ ...prev, [spec.name]: (e.target as HTMLInputElement).value }))
            }
          />
          <button
            style={styles.samplingClearBtn}
            type="button"
            disabled={current === ''}
            title="Clear this parameter — it stops being sent, falling back to the flavor/server value"
            onClick={() => setText((prev) => ({ ...prev, [spec.name]: '' }))}
          >
            ✕
          </button>
        </div>
        <div style={styles.samplingHelp}>{spec.help}</div>
      </div>
    );
  }

  return (
    <div
      style={styles.modalOverlay}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div style={styles.samplingModalBox} role="dialog" aria-modal="true">
        <div style={styles.modalTitle}>Sampling parameters — {model}</div>
        <div style={styles.modalInstructions}>
          Applies to every request this session sends to {model}, and is remembered per quant —
          switching models and back restores what you set here. Leave a field blank to not send it
          at all, letting the flavor&apos;s launch arguments decide. {overriddenCount === 0
            ? 'Nothing is overridden right now.'
            : `${overriddenCount} parameter${overriddenCount === 1 ? '' : 's'} overridden.`}
        </div>
        <div style={styles.samplingModalBody}>
          <div style={styles.samplingSectionHeader}>Common</div>
          {curated.map(field)}
          <button
            style={styles.samplingAdvancedToggle}
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
          >
            {showAdvanced ? '▼' : '▶'} Advanced ({advanced.length})
          </button>
          {showAdvanced && advanced.map(field)}
        </div>
        <div style={styles.modalButtonRow}>
          <button style={styles.modalCancelBtn} type="button" onClick={clearAll}>
            Clear all
          </button>
          <button style={styles.modalCancelBtn} type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" onClick={apply}>
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
