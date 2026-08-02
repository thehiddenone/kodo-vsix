import { useEffect, useState } from 'preact/hooks';
import { SelectRow } from './SelectRow';
import type { StuckDetectionSettings, UiSettings } from './types';
import { vscode } from './vscode';

// 'system' resolves to the runtime's local IANA zone (host-side format.ts's
// resolveTimeZone); every other value is a real IANA zone id used as-is —
// 'UTC' plus a curated set of common hubs, not an exhaustive list.
const TIMEZONE_OPTIONS: [string, string][] = [
  ['system', 'System locale'],
  ['UTC', 'UTC'],
  ['America/Los_Angeles', 'Pacific Time (Los Angeles)'],
  ['America/Denver', 'Mountain Time (Denver)'],
  ['America/Chicago', 'Central Time (Chicago)'],
  ['America/New_York', 'Eastern Time (New York)'],
  ['America/Sao_Paulo', 'São Paulo'],
  ['Europe/London', 'London'],
  ['Europe/Paris', 'Paris / Berlin'],
  ['Europe/Moscow', 'Moscow'],
  ['Asia/Kolkata', 'India (Kolkata)'],
  ['Asia/Singapore', 'Singapore / Hong Kong'],
  ['Asia/Tokyo', 'Tokyo'],
  ['Australia/Sydney', 'Sydney'],
];

// <dateOrder>_<12h|24h> — mirrors webview/types.ts's ClockFormatPreset union
// (kept as plain strings here, see host-side UiSettings doc comment).
const CLOCK_FORMAT_OPTIONS: [string, string][] = [
  ['ymd_24h', 'YYYY-MM-DD, 24-hour (2026-07-23 14:41)'],
  ['ymd_12h', 'YYYY-MM-DD, 12-hour (2026-07-23 2:41 PM)'],
  ['mdy_24h', 'MM/DD/YYYY, 24-hour (07/23/2026 14:41)'],
  ['mdy_12h', 'MM/DD/YYYY, 12-hour (07/23/2026 2:41 PM)'],
  ['dmy_24h', 'DD/MM/YYYY, 24-hour (23/07/2026 14:41)'],
  ['dmy_12h', 'DD/MM/YYYY, 12-hour (23/07/2026 2:41 PM)'],
];

const STUCK_ACTIVE_OPTIONS: [StuckDetectionSettings['active'], string][] = [
  ['off', 'Off'],
  ['local_only', 'Only for local LLMs'],
  ['local_and_cloud', 'Both local LLMs and cloud LLMs'],
];

function PromptSubmitSection({ uiSettings }: { uiSettings: UiSettings }) {
  const post = (next: UiSettings) => vscode.postMessage({ type: 'set_ui_settings', ...next });
  return (
    <div>
      <div className="section-subheading">How to submit a prompt</div>
      <p className="intro-text">
        Choose which key sends your prompt to Kōdo, and which one adds a new line in the input box instead.
      </p>
      <div className="radio-group">
        <label className="radio-row">
          <input
            type="radio"
            name="enter-submits"
            checked={!uiSettings.enterSubmits}
            onChange={(e) => (e.target as HTMLInputElement).checked && post({ ...uiSettings, enterSubmits: false })}
          />
          Enter adds a new line, Shift+Enter sends the prompt
        </label>
        <label className="radio-row">
          <input
            type="radio"
            name="enter-submits"
            checked={uiSettings.enterSubmits}
            onChange={(e) => (e.target as HTMLInputElement).checked && post({ ...uiSettings, enterSubmits: true })}
          />
          Shift+Enter adds a new line, Enter sends the prompt
        </label>
      </div>
    </div>
  );
}

function ShowTimestampsSection({ uiSettings }: { uiSettings: UiSettings }) {
  const post = (next: UiSettings) => vscode.postMessage({ type: 'set_ui_settings', ...next });
  const disabled = !uiSettings.showTimestamps;
  return (
    <div>
      <div className="section-subheading">Show Timestamps</div>
      <p className="intro-text">
        Show when each message, response, and tool call happened, as a small line above it in the conversation.
      </p>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={uiSettings.showTimestamps}
          onChange={(e) => post({ ...uiSettings, showTimestamps: (e.target as HTMLInputElement).checked })}
        />
        Show timestamps
      </label>
      <SelectRow
        labelText="Time zone"
        options={TIMEZONE_OPTIONS}
        value={uiSettings.timezone}
        disabled={disabled}
        onChange={(value) => post({ ...uiSettings, timezone: value })}
      />
      <SelectRow
        labelText="Format"
        options={CLOCK_FORMAT_OPTIONS}
        value={uiSettings.clockFormat}
        disabled={disabled}
        onChange={(value) => post({ ...uiSettings, clockFormat: value })}
      />
    </div>
  );
}

function StuckDetectionSection({ stuckDetection }: { stuckDetection: StuckDetectionSettings }) {
  // Unlike ShowTimestamps/uiSettings (a local file write, echoed back
  // synchronously) or the cloud-model <select> (pushed back synchronously
  // too), `set_stuck_detection` is a real awaited WS round trip to the kodo
  // server (kodo-settings-bridge.ts's `onKodoSettingsMessage`). The original
  // wrote `_state.stuckDetection` optimistically and re-rendered before that
  // resolved; mirror that here with local state, reconciled from the prop
  // once the server confirms (or left as-is on failure — same as the
  // original, which never explicitly reverted an optimistic write either).
  const [local, setLocal] = useState(stuckDetection);
  useEffect(() => setLocal(stuckDetection), [stuckDetection]);
  const post = (next: StuckDetectionSettings) => {
    setLocal(next);
    vscode.postMessage({ type: 'set_stuck_detection', ...next });
  };
  const disabled = local.active === 'off';
  return (
    <div>
      <div className="section-subheading">Detect Stuck Agentic Workflows</div>
      <p className="intro-text">
        Sometimes a model stops before it&apos;s actually finished a task — for example, it replies with nothing
        useful, or just &quot;Done.&quot; When Kōdo notices this happening, it can nudge the model to pick up where
        it left off and finish the job.
      </p>
      <div className="radio-group">
        {STUCK_ACTIVE_OPTIONS.map(([value, label]) => (
          <label className="radio-row" key={value}>
            <input
              type="radio"
              name="stuck-active"
              checked={local.active === value}
              onChange={(e) => (e.target as HTMLInputElement).checked && post({ ...local, active: value })}
            />
            {label}
          </label>
        ))}
      </div>
      <label className="checkbox-row">
        <input
          type="checkbox"
          disabled={disabled}
          checked={local.scope === 'top_level_and_subagents'}
          onChange={(e) => post({
            ...local,
            scope: (e.target as HTMLInputElement).checked ? 'top_level_and_subagents' : 'top_level',
          })}
        />
        Also watch sub-agent turns
      </label>
      <label className="checkbox-row">
        <input
          type="checkbox"
          disabled={disabled}
          checked={local.auto_unstuck_interactive}
          onChange={(e) => post({
            ...local,
            auto_unstuck_interactive: (e.target as HTMLInputElement).checked,
          })}
        />
        Nudge LLM automatically without asking me
      </label>
    </div>
  );
}

interface GeneralSectionProps {
  uiSettings: UiSettings;
  stuckDetection: StuckDetectionSettings;
}

export function GeneralSection({ uiSettings, stuckDetection }: GeneralSectionProps) {
  return (
    <div>
      <h2>General</h2>
      <hr className="section-divider" />
      <PromptSubmitSection uiSettings={uiSettings} />
      <hr className="section-divider" />
      <ShowTimestampsSection uiSettings={uiSettings} />
      <hr className="section-divider" />
      <StuckDetectionSection stuckDetection={stuckDetection} />
    </div>
  );
}
