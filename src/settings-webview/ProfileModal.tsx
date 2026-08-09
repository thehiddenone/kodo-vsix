/**
 * Manage-profiles modal — an entry's **user-defined** launch configurations
 * (kodo/doc/LLM_REGISTRY.md §4.6). List-detail: the left pane lists this
 * entry's profiles, selecting one populates the right pane's editor.
 *
 * The Default profile is deliberately absent. It is not a profile at all — it
 * has no stored args, only a knob selection — and it is edited in the
 * Configure modal instead. Every profile listed here is user-defined and
 * therefore fully editable; there is no read-only variant any more, which is
 * what the predefined-flavor gating this modal replaces used to be for.
 *
 * The argument editor is two views of one string. The picker renders a typed
 * row per flag found in `llamaArgsText` that the server's curated catalog
 * knows about (kodo/doc/LLM_REGISTRY.md §4.7) — label, an input matching the
 * flag's kind, its help text, and a remove button — and "Add argument" adds a
 * row for a flag not yet present. Everything else lands in the raw "one flag
 * per line" box below, which is the escape hatch for flags the catalog does
 * not cover. Both read and write `llamaArgsText`, so they can never disagree.
 *
 * Save is disabled while any picker row is marked ⚠ — an unknown `--samplers`
 * stage name, unparseable text, or a value outside its recommended band
 * (kodo/doc/SAMPLING.md §8d/§8e) — and while the name is blank or clashes.
 * "Add" creates a real profile immediately rather than opening a blank form,
 * then selects it once its server-assigned id arrives in the next
 * registry_state push.
 */

import { useEffect, useState } from 'preact/hooks';
import {
  argIssue,
  availableArgSpecs,
  llamaArgRows,
  llamaArgsToText,
  parseLlamaArgsText,
  removeLlamaArg,
  setLlamaArg,
} from './localLlmUtils';
import type { LlamaArgSpec, LocalProfile, LocalRegistryEntry } from './types';
import { vscode } from './vscode';

interface ProfileModalProps {
  entry: LocalRegistryEntry;
  /** The server's curated llama-server flag table. `[]` before the first
   *  registry payload lands, which simply leaves the raw text box as the only
   *  way to add arguments. */
  llamaArgCatalog: LlamaArgSpec[];
  onClose: () => void;
}

export function ProfileModal({ entry, llamaArgCatalog, onClose }: ProfileModalProps) {
  const profiles = entry.profiles || [];
  const [selectedId, setSelectedId] = useState<string | null>(profiles[0]?.id ?? null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [llamaArgsText, setLlamaArgsText] = useState('');
  const [addFlag, setAddFlag] = useState('');
  const [showAdvancedArgs, setShowAdvancedArgs] = useState(false);
  // Name of a profile just created via `addProfile`, waiting for its
  // server-assigned id (slugified from the name, de-duplicated) to show up in
  // `profiles` so it can be selected.
  const [pendingNewName, setPendingNewName] = useState<string | null>(null);

  const selected = profiles.find((p) => p.id === selectedId) || null;

  // Re-sync the form ONLY when the selection itself changes — deliberately NOT
  // keyed on the selected profile's field values. `KodoSettingsPanel` pushes
  // its ENTIRE state on every update (a download-progress tick, an unrelated
  // llamaCpp.busy flip, …), re-serializing `localRegistry` and handing this
  // component a new `llama_args` object identity even when its content is
  // unchanged; keying the effect on those values would reset the form and
  // clobber an in-progress edit on every unrelated background push.
  useEffect(() => {
    setName(selected?.name ?? '');
    setDescription(selected?.description ?? '');
    setLlamaArgsText(selected ? llamaArgsToText(selected.llama_args) : '');
    setAddFlag('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // The selection may have vanished (removed here or in another window).
  useEffect(() => {
    if (selectedId && !profiles.some((p) => p.id === selectedId)) {
      setSelectedId(profiles[0]?.id ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles]);

  // Selects the profile `addProfile` just created, once it round-trips back.
  useEffect(() => {
    if (!pendingNewName) { return; }
    const created = profiles.find((p) => p.name === pendingNewName);
    if (created) {
      setSelectedId(created.id);
      setPendingNewName(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles, pendingNewName]);

  const trimmedName = name.trim();
  // Excludes the profile being edited, so re-saving under its own unchanged
  // name isn't flagged as a clash with itself.
  const nameDup = Boolean(trimmedName) && profiles.some((p) => p.id !== selectedId && p.name === trimmedName);

  const catalogByFlag = new Map(llamaArgCatalog.map((spec) => [spec.flag, spec]));
  const rows = llamaArgRows(llamaArgsText);
  const knownRows = rows.filter((row) => catalogByFlag.has(row.flag));
  // Flags the catalog doesn't cover live only in the raw box — surfacing them
  // as untyped picker rows would imply an editing affordance that isn't there.
  const unknownArgs = Object.fromEntries(
    rows.filter((row) => !catalogByFlag.has(row.flag)).map((row) => [row.flag, row.value]),
  );

  const anyIssue = knownRows.some((row) => argIssue(catalogByFlag.get(row.flag)!, row.value) !== null);
  const canSave = Boolean(selected) && Boolean(trimmedName) && !nameDup && !anyIssue;

  function save() {
    if (!canSave || !selectedId) { return; }
    vscode.postMessage({
      type: 'update_profile',
      name: entry.name,
      profile_id: selectedId,
      profile_name: trimmedName,
      description: description.trim(),
      llama_args_text: llamaArgsText,
    });
  }

  /** Creates a profile immediately, with a unique "New profile" name and the
   *  Default profile's currently-resolved args as a starting point — the most
   *  useful baseline to edit from, and the only arg set that is guaranteed to
   *  launch. */
  function addProfile() {
    const existing = new Set(profiles.map((p) => p.name));
    let newName = 'New profile';
    let suffix = 2;
    while (existing.has(newName)) {
      newName = `New profile ${suffix}`;
      suffix += 1;
    }
    setSelectedId(null);
    setPendingNewName(newName);
    vscode.postMessage({
      type: 'add_profile',
      name: entry.name,
      profile_name: newName,
      description: 'Custom profile',
      llama_args_text: llamaArgsToText(entry.default_profile_args || {}),
    });
  }

  function argInput(spec: LlamaArgSpec, value: string) {
    const onValue = (next: string) => setLlamaArgsText(setLlamaArg(llamaArgsText, spec.flag, next));
    if (spec.kind === 'bool') {
      return <span className="arg-bare">(no value)</span>;
    }
    if (spec.kind === 'enum') {
      return (
        <select
          className="settings-select"
          value={value}
          onChange={(e) => onValue((e.target as HTMLSelectElement).value)}
        >
          <option value="">(unset)</option>
          {(spec.choices || []).map((choice) => (
            <option key={choice} value={choice}>{choice}</option>
          ))}
        </select>
      );
    }
    return (
      <input
        type={spec.kind === 'int' || spec.kind === 'float' ? 'number' : 'text'}
        min={spec.minimum ?? undefined}
        max={spec.maximum ?? undefined}
        step={spec.step ?? undefined}
        autocomplete="off"
        placeholder={spec.placeholder || spec.default || ''}
        value={value}
        onInput={(e) => onValue((e.target as HTMLInputElement).value)}
      />
    );
  }

  function argRow(spec: LlamaArgSpec, value: string) {
    const issue = argIssue(spec, value);
    return (
      <div className="arg-row" key={spec.flag}>
        <div className="arg-head">
          <span className="arg-label" title={spec.flag}>
            {/* Always mounted — visibility (not presence) toggles, so the row
                never shifts as `issue` flips while typing. */}
            <span
              className="sampling-warn"
              style={{ visibility: issue !== null ? 'visible' : 'hidden' }}
              title={issue ?? undefined}
              role={issue !== null ? 'img' : undefined}
              aria-hidden={issue === null}
              aria-label={issue ?? undefined}
            >⚠</span>
            {spec.label}
          </span>
          {argInput(spec, value)}
          <button
            className="secondary-btn arg-remove"
            type="button"
            title={`Remove ${spec.flag}`}
            onClick={() => setLlamaArgsText(removeLlamaArg(llamaArgsText, spec.flag))}
          >
            ✕
          </button>
        </div>
        <div className="arg-help">
          <code>{spec.flag}</code> — {spec.help}
          {spec.default ? ` Default: ${spec.default}.` : ''}
        </div>
      </div>
    );
  }

  // Grouped by the catalog's own `category`, in first-seen order, so the
  // "Add argument" dropdown reads the way the catalog is written.
  const addable = availableArgSpecs(llamaArgCatalog, llamaArgsText).filter(
    (spec) => showAdvancedArgs || !spec.advanced,
  );
  const categories: string[] = [];
  for (const spec of addable) {
    if (!categories.includes(spec.category)) { categories.push(spec.category); }
  }

  return (
    <div className="li-modal-overlay open" onClick={(e) => { if (e.target === e.currentTarget) { onClose(); } }}>
      <div className="modal-dialog flavor-modal-dialog" role="dialog" aria-modal="true">
        <h3>Manage profiles — {entry.description || entry.name}</h3>
        <p className="explain">
          A profile is your own named set of llama.cpp launch arguments for this LLM. Selecting one from the
          sidebar <strong>fully replaces</strong> the Default profile&apos;s arguments — the two are never combined.
          The Default profile itself isn&apos;t listed here; configure it with the &quot;Configure&quot; button instead.
        </p>
        <div className="flavor-modal-body">
          <div className="flavor-list-pane">
            <div className="flavor-list">
              {profiles.length === 0 && (
                <div className="flavor-row-desc">No profiles yet — press &quot;Add&quot; to create one.</div>
              )}
              {profiles.map((p: LocalProfile) => (
                <div
                  key={p.id}
                  className={'flavor-list-row' + (p.id === selectedId ? ' selected' : '')}
                  onClick={() => setSelectedId(p.id)}
                >
                  <div className="flavor-row-name">
                    {p.name}{p.id === entry.active_profile ? ' (active)' : ''}
                  </div>
                  {p.description && <div className="flavor-row-desc">{p.description}</div>}
                </div>
              ))}
            </div>
            <div className="flavor-list-actions">
              <button className="secondary-btn" type="button" onClick={addProfile}>Add</button>
              <button
                className="secondary-btn"
                type="button"
                disabled={!selected}
                onClick={() => {
                  if (!selected) { return; }
                  vscode.postMessage({ type: 'remove_profile', name: entry.name, profile_id: selected.id });
                }}
              >
                Remove
              </button>
            </div>
          </div>
          <div className="flavor-form-pane">
            {!selected && (
              <div className="field-hint">
                Select a profile on the left, or press &quot;Add&quot; to create one.
              </div>
            )}
            {selected && (
              <>
                <div className="modal-field">
                  <label for="profile-name">Name</label>
                  <input
                    type="text"
                    id="profile-name"
                    autocomplete="off"
                    value={name}
                    onInput={(e) => setName((e.target as HTMLInputElement).value)}
                  />
                  <div className="field-error">
                    {nameDup ? `A profile named "${trimmedName}" already exists for this LLM.` : ''}
                  </div>
                </div>
                <div className="modal-field">
                  <label for="profile-description">Description (optional)</label>
                  <input
                    type="text"
                    id="profile-description"
                    autocomplete="off"
                    value={description}
                    onInput={(e) => setDescription((e.target as HTMLInputElement).value)}
                  />
                </div>
                <hr className="section-divider" />
                <div className="field-hint">
                  llama.cpp launch arguments. Pick one from the list to add a row for it; a ⚠ next to a row means
                  the value is outside the range normally worth using, or isn&apos;t valid at all — hover it for
                  details, and fix or remove it to re-enable Save. Sampling arguments can also be fine-tuned per
                  session, live and without a restart, from the ⚙ button in the chat footer.
                </div>
                <div className="arg-list">
                  {knownRows.length === 0 && (
                    <div className="field-hint">No arguments yet.</div>
                  )}
                  {knownRows.map((row) => argRow(catalogByFlag.get(row.flag)!, row.value))}
                </div>
                {llamaArgCatalog.length > 0 && (
                  <div className="arg-add-row">
                    <select
                      className="settings-select"
                      value={addFlag}
                      onChange={(e) => {
                        const flag = (e.target as HTMLSelectElement).value;
                        if (!flag) { return; }
                        const spec = catalogByFlag.get(flag);
                        setLlamaArgsText(setLlamaArg(llamaArgsText, flag, spec?.kind === 'bool' ? '' : ''));
                        setAddFlag('');
                      }}
                    >
                      <option value="">+ Add argument…</option>
                      {categories.map((category) => (
                        <optgroup key={category} label={category}>
                          {addable
                            .filter((spec) => spec.category === category)
                            .map((spec) => (
                              <option key={spec.flag} value={spec.flag}>
                                {spec.label} ({spec.flag})
                              </option>
                            ))}
                        </optgroup>
                      ))}
                    </select>
                    <label className="knob-checkbox-label">
                      <input
                        type="checkbox"
                        checked={showAdvancedArgs}
                        onChange={(e) => setShowAdvancedArgs((e.target as HTMLInputElement).checked)}
                      />
                      Show advanced arguments
                    </label>
                  </div>
                )}
                <hr className="section-divider" />
                <div className="modal-field">
                  <label for="profile-raw-args">Other arguments (one flag per line)</label>
                  <textarea
                    id="profile-raw-args"
                    rows={4}
                    placeholder={'--override-tensor exps=CPU'}
                    value={llamaArgsToText(unknownArgs)}
                    onInput={(e) => {
                      // The raw box owns only the flags the catalog doesn't
                      // know about; the picker's rows are re-appended verbatim
                      // so editing here can never drop them.
                      const raw = parseLlamaArgsText((e.target as HTMLTextAreaElement).value);
                      const kept = Object.fromEntries(knownRows.map((row) => [row.flag, row.value]));
                      setLlamaArgsText(llamaArgsToText({ ...kept, ...raw }));
                    }}
                  />
                  <div className="field-hint">
                    For flags not in the list above. Anything kōdo sets itself (the model path, host, port, log
                    file, and the per-session thinking budget) is ignored here.
                  </div>
                </div>
              </>
            )}
            {selected && <hr className="section-divider" />}
            <div className="modal-actions">
              {selected && (
                <button
                  id="profile-save-btn"
                  disabled={!canSave}
                  title={anyIssue ? 'Fix the argument(s) marked ⚠ before saving' : undefined}
                  onClick={save}
                >
                  Save
                </button>
              )}
              <button className="secondary-btn" onClick={onClose}>Close</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
