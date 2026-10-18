import { useEffect, useState } from 'preact/hooks';
import type { HarborModelOption, HarborOptionsResult } from './types';
import { vscode } from './vscode';

export type BenchmarkMode = 'benchmark' | 'basics';

interface BenchmarkModalProps {
  /** The top-level agent to run, and what to call it. */
  agent: string;
  label: string;
  /** A Basics test is the `agent-basics` preset: 1 attempt, no control (§5.4). */
  mode: BenchmarkMode;
  /** Latest `harbor.options` reply; `null` until it lands. The App clears it
   * when the modal opens, so a reply left from an earlier opening is never read. */
  options: HarborOptionsResult | null;
  onClose: () => void;
}

const MAX_ATTEMPTS = 10;

/** A model the modal can run: not a runtime-catalog placeholder row
 * (`openrouter/<MODEL_ID>`), which names no model `kodo-harbor` could run. */
function runnable(model: HarborModelOption): boolean {
  return !model.model.includes('<');
}

function usable(model: HarborModelOption): boolean {
  return model.credential !== false;
}

/** "Benchmark…" and "Basics test" on a top-level agent (kodo/doc/AGENT_BUILDER.md
 * §8). The modal only builds the run: Run opens a new Kōdo session tab, where
 * the server runs `kodo-harbor` and shows its progress and summary
 * (kodo/doc/BENCHMARK_SESSIONS.md §5). A local model runs on the server's own
 * llama-server, so there is no second copy to warn about (D6 retired D20). */
export function BenchmarkModal({ agent, label, mode, options, onClose }: BenchmarkModalProps) {
  const basics = mode === 'basics';
  const models = (options?.models ?? []).filter(runnable);
  const local = models.filter((m) => m.kind === 'local');
  const cloud = models.filter((m) => m.kind !== 'local');
  const [model, setModel] = useState('');
  const [suite, setSuite] = useState('');
  const [attempts, setAttempts] = useState(1);
  const [thinking, setThinking] = useState('');
  const [control, setControl] = useState(false);

  // Defaults once the options land: the first model that can run, and the
  // first suite other than the basics test's own.
  useEffect(() => {
    if (options === null || !options.ok) {
      return;
    }
    setModel((current) => current || (models.find(usable)?.model ?? ''));
    setSuite((current) => current
      || (basics ? options.basicsSuite : options.suites.find((s) => s.name !== options.basicsSuite)?.name)
      || options.suites[0]?.name
      || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options]);

  const chosen = models.find((m) => m.model === model) ?? null;
  const controlAgent = options?.controls[0] ?? '';
  const canControl = !basics && chosen !== null && chosen.control && controlAgent !== '';

  function pickModel(name: string) {
    setModel(name);
    setThinking('');
    setControl(false);
  }

  function start() {
    if (chosen === null || !suite) {
      return;
    }
    vscode.postMessage({
      type: 'run_benchmark',
      agent,
      model: chosen.model,
      suite,
      attempts: basics ? 1 : attempts,
      thinkingLevel: thinking,
      control: canControl && control,
    });
    onClose();
  }

  const modelLabel = (m: HarborModelOption): string => {
    const name = m.description ? `${m.model} — ${m.description}` : m.model;
    return m.credential === false ? `${name} (no key)` : name;
  };

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="modal-box" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3>{basics ? 'Basics test' : 'Benchmark'} {label}</h3>

        {options === null && <p className="modal-intro">Reading the models and suites…</p>}
        {options !== null && !options.ok && (
          <p className="field-error">Could not read the benchmark options — {options.error}</p>
        )}

        {options !== null && options.ok && (
          <>
            <p className="modal-intro">
              {basics ? (
                <>
                  Runs the <span className="value-code">{options.basicsSuite}</span> suite once: seven
                  small tasks in one container that check whether this agent's prompt makes it follow
                  instructions and use its tools. Each task gets its own score.
                </>
              ) : (
                <>Runs a Harbor benchmark of this agent with <span className="value-code">kodo-harbor</span>.</>
              )}{' '}
              It runs in a new Kōdo session tab, which shows each finished trial and the summary,
              and needs Docker. A local model runs on Kōdo's own llama.cpp: local chats in other
              sessions wait until the run ends.
            </p>
            <div className="modal-field">
              <label for="bench-model">Model</label>
              <select
                id="bench-model"
                className="settings-select"
                value={model}
                onChange={(e) => pickModel((e.target as HTMLSelectElement).value)}
              >
                {local.length > 0 && (
                  <optgroup label="Local">
                    {local.map((m) => <option key={m.model} value={m.model}>{modelLabel(m)}</option>)}
                  </optgroup>
                )}
                {cloud.length > 0 && (
                  <optgroup label="Cloud">
                    {cloud.map((m) => (
                      <option key={m.model} value={m.model} disabled={!usable(m)}>{modelLabel(m)}</option>
                    ))}
                  </optgroup>
                )}
              </select>
              {models.length === 0 && (
                <div className="field-error">No model can run: install a local model or add a cloud key.</div>
              )}
              {cloud.some((m) => !usable(m)) && (
                <div className="field-hint">
                  A cloud model marked "no key" needs an API key in Kōdo's Cloud AI settings or in your
                  environment.
                </div>
              )}
            </div>
            {!basics && (
              <>
                <div className="modal-field">
                  <label for="bench-suite">Suite</label>
                  <select
                    id="bench-suite"
                    className="settings-select"
                    value={suite}
                    onChange={(e) => setSuite((e.target as HTMLSelectElement).value)}
                  >
                    {options.suites.map((s) => (
                      <option key={s.name} value={s.name}>{s.name} — {s.description}</option>
                    ))}
                  </select>
                </div>
                <div className="modal-field">
                  <label for="bench-attempts">Attempts per task</label>
                  <input
                    type="number"
                    id="bench-attempts"
                    min={1}
                    max={MAX_ATTEMPTS}
                    value={attempts}
                    onInput={(e) => {
                      const value = Number((e.target as HTMLInputElement).value);
                      setAttempts(Number.isInteger(value) ? Math.min(MAX_ATTEMPTS, Math.max(1, value)) : 1);
                    }}
                  />
                </div>
              </>
            )}
            {chosen !== null && chosen.thinkingTiers.length > 0 && (
              <div className="modal-field">
                <label for="bench-thinking">Thinking level</label>
                <select
                  id="bench-thinking"
                  className="settings-select"
                  value={thinking}
                  onChange={(e) => setThinking((e.target as HTMLSelectElement).value)}
                >
                  <option value="">Model default ({chosen.defaultThinkingTier})</option>
                  {chosen.thinkingTiers.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            )}
            {!basics && (
              <div className="modal-field">
                <label title={canControl ? '' : 'A control arm runs only on a cloud model it supports'}>
                  <input
                    type="checkbox"
                    checked={canControl && control}
                    disabled={!canControl}
                    onChange={(e) => setControl((e.target as HTMLInputElement).checked)}
                  />{' '}
                  Also run {controlAgent || 'terminus-2'} on the same model, as a control
                </label>
              </div>
            )}
            <div className="modal-actions">
              <button className="secondary-btn" onClick={onClose}>Cancel</button>
              <button onClick={start} disabled={chosen === null || !usable(chosen) || !suite}>
                Run
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
