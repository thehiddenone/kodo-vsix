// A benchmark trial's agent activity as chat-feed entries. The events are the
// ones `kodo-headless` writes to the trial's `kodo.jsonl` (kodo
// doc/HEADLESS.md §2.1), which the server forwards as `harbor.activity`; this
// turns them into the same `SessionEntry` shapes a live session's feed holds,
// so `SessionEntryView` and `groupSessionEntries` render them unchanged.
// Events with no feed counterpart (`run.start`, `phase`, `llm.turn`,
// `agent.start`/`finish`, `tool.denied` — the tool card already shows the
// call — `question`, `transcript.exported`, `run.result`) are left out.
import type { SessionEntry, ToolCallDetailRow } from './types';

type ToolCallEntry = Extract<SessionEntry, { type: 'tool_call' }>;

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function timestamp(value: unknown): number | null {
  const ms = Date.parse(text(value));
  return Number.isNaN(ms) ? null : ms;
}

function toolCard(event: Record<string, unknown>): ToolCallEntry {
  return {
    type: 'tool_call',
    toolName: text(event.tool),
    description: '',
    toolCallId: text(event.tool_call_id),
    ts: timestamp(event.ts),
    rows: [],
    detailFile: null,
    schemaCompliance: null,
    success: null,
    timeoutSeconds: null,
    startedAt: null,
    diff: null,
    checkpoint: null,
    toolgenDurationMs: null,
    toolgenChars: null,
    webSearchNotes: [],
    exclude_from_context: false,
  };
}

function detailRows(value: unknown): ToolCallDetailRow[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((row): row is Record<string, unknown> => row !== null && typeof row === 'object')
    .map((row) => ({
      name: text(row.name),
      value: text(row.value),
      source: row.source === 'output' ? 'output' : 'input',
      visibility: row.visibility === 'visible' ? 'visible' : 'always',
    }));
}

/** One log's events → the feed entries a live session would have shown. */
export function activityEntries(events: (Record<string, unknown> | undefined)[]): SessionEntry[] {
  const entries: SessionEntry[] = [];
  const cards = new Map<string, number>();
  // Display names of the agents in charge, innermost last (the top-level
  // agent's is its internal name: run.start carries no other).
  const scopes: string[] = [];
  for (const event of events) {
    if (event === undefined || event === null) {
      continue;
    }
    switch (text(event.type)) {
      case 'run.start':
        scopes.splice(0, scopes.length, text(event.agent) || 'Kōdo');
        break;
      case 'thinking':
        if (text(event.text)) {
          entries.push({ type: 'thinking_block', content: text(event.text), durationMs: null, exclude_from_context: true });
        }
        break;
      case 'text':
        if (text(event.text)) {
          entries.push({ type: 'assistant_response', content: text(event.text), ts: timestamp(event.ts), exclude_from_context: false });
        }
        break;
      case 'tool.start':
        cards.set(text(event.tool_call_id), entries.length);
        entries.push(toolCard(event));
        break;
      case 'tool.call': {
        const id = text(event.tool_call_id);
        let index = cards.get(id);
        if (index === undefined) {
          index = entries.length;
          cards.set(id, index);
          entries.push(toolCard(event));
        }
        const card = entries[index] as ToolCallEntry;
        entries[index] = {
          ...card,
          rows: detailRows(event.rows),
          schemaCompliance: typeof event.schema_compliance === 'boolean' ? event.schema_compliance : null,
          success: typeof event.success === 'boolean' ? event.success : null,
        };
        break;
      }
      case 'usage':
        entries.push({
          type: 'status_response',
          durationMs: count(event.duration_seconds) * 1000,
          inputTokens: count(event.input_tokens),
          outputTokens: count(event.output_tokens),
          contextTokens: count(event.input_tokens),
          exclude_from_context: true,
        });
        break;
      case 'subsession.start': {
        const name = text(event.display_name) || text(event.agent);
        entries.push({
          type: 'subsession_divider',
          phase: 'start',
          displayName: name,
          parentDisplayName: scopes[scopes.length - 1] ?? 'Kōdo',
          exclude_from_context: true,
        });
        if (text(event.task)) {
          entries.push({ type: 'subagent_task', content: text(event.task), exclude_from_context: true });
        }
        scopes.push(name);
        break;
      }
      case 'subsession.end': {
        const name = text(event.display_name) || text(event.agent);
        if (scopes.length > 1) {
          scopes.pop();
        }
        entries.push({
          type: 'subsession_divider',
          phase: 'end',
          displayName: name,
          parentDisplayName: scopes[scopes.length - 1] ?? 'Kōdo',
          failed: event.failed === true,
          exclude_from_context: true,
        });
        break;
      }
      case 'error':
      case 'warning':
        entries.push({
          type: 'error_notice',
          message: text(event.message),
          recoverable: event.type === 'warning' || event.recoverable === true,
          exclude_from_context: true,
        });
        break;
      case 'nudge': {
        const reasons = Array.isArray(event.reasons) ? event.reasons.map((r) => String(r)) : [];
        entries.push({
          type: 'nudge',
          uiText: text(event.ui_text) || `Kōdo nudged the agent (${reasons.join(', ') || 'stalled'}).`,
          reasons,
          mode: text(event.mode),
          source: '',
          exclude_from_context: true,
        });
        break;
      }
      default:
        break;
    }
  }
  return entries;
}
