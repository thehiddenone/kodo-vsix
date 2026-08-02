/**
 * Envelope → webview-message translations (plus the odd native notification)
 * that touch no controller state at all — agent/tool-call narration, error/
 * diagnostic events, and the sent-attachments echo. Split out from
 * `controller.ts`'s `_onEnvelope` purely to shrink that dispatcher; every
 * branch here is a pure "given this event, post/notify this" mapping.
 */

import * as vscode from 'vscode';
import type { Envelope } from '../envelope';

type Post = (msg: Record<string, unknown>) => void;

/** Attempt to handle `env` as one of the stateless event/notification
 *  translations. Returns `true` if handled (caller should stop dispatching). */
export function handleStatelessEnvelope(env: Envelope, evtType: string, post: Post): boolean {
  if (env.kind === 'event' && evtType === 'session.naming') {
    post({ type: 'session_naming', active: Boolean(env.payload.active) });
    return true;
  }

  if (env.kind === 'event' && evtType === 'agent.finished') {
    post({ type: 'agent_finished', agent: String(env.payload.agent ?? '') });
    return true;
  }

  if (env.kind === 'event' && evtType === 'subsession.started') {
    post({
      type: 'subsession_started',
      agent: String(env.payload.agent ?? ''),
      displayName: String(env.payload.display_name ?? ''),
      task: String(env.payload.task ?? ''),
    });
    return true;
  }

  if (env.kind === 'event' && evtType === 'subsession.ended') {
    post({
      type: 'subsession_ended',
      agent: String(env.payload.agent ?? ''),
      displayName: String(env.payload.display_name ?? ''),
      parentDisplayName: String(env.payload.parent_display_name ?? ''),
      failed: env.payload.failed === true,
    });
    return true;
  }

  // The server stored this prompt's attachments and copied them into the
  // session. Hand the absolute stored-copy paths to the webview so the chips
  // on the just-sent bubble open the durable copies (not the originals).
  if (env.kind === 'event' && evtType === 'user.attachments') {
    const raw = Array.isArray(env.payload.attachments) ? env.payload.attachments : [];
    const attachments = raw.map((a) => {
      const rec = a as Record<string, unknown>;
      return { name: String(rec.name ?? ''), path: String(rec.path ?? '') };
    });
    post({ type: 'sent_attachments', attachments });
    return true;
  }

  if (env.kind === 'event' && evtType === 'llm.turn_start') {
    post({ type: 'llm_turn_start' });
    return true;
  }

  if (env.kind === 'event' && evtType === 'llm.waiting') {
    const waiting = Boolean(env.payload.waiting);
    const reason = String(env.payload.reason ?? 'queued');
    const retryIn = typeof env.payload.retry_in_seconds === 'number' ? env.payload.retry_in_seconds : null;
    post({ type: 'llm_waiting', waiting, reason, retryIn });
    if (waiting && reason === 'throttled' && retryIn) {
      const mins = Math.max(1, Math.round(retryIn / 60));
      void vscode.window
        .withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Kōdo: rate-limited by the LLM provider — retrying in ~${mins} min`,
            cancellable: false,
          },
          () => new Promise<void>((resolve) => setTimeout(resolve, 60_000)),
        )
        .then(undefined, () => undefined);
    }
    return true;
  }

  if (env.kind === 'event' && evtType === 'agent.tool_call_prep') {
    post({
      type: 'tool_call',
      toolName: String(env.payload.tool_name ?? ''),
      description: String(env.payload.description ?? ''),
      toolCallId: String(env.payload.tool_call_id ?? ''),
      timeoutSeconds: typeof env.payload.timeout_seconds === 'number' ? env.payload.timeout_seconds : null,
    });
    return true;
  }

  // Fired once the security gate clears (allowed outright, or the user
  // granted permission) and the tool is genuinely about to run — tells the
  // webview to start the run_command/web_search timeout bar's clock now,
  // not at agent.tool_call_prep time (see doc/SECURITY.md §6).
  if (env.kind === 'event' && evtType === 'agent.tool_call_in_progress') {
    post({ type: 'tool_call_in_progress', toolCallId: String(env.payload.tool_call_id ?? '') });
    return true;
  }

  // Live narration from the web_search agent's tool loop (doc/WEB_SEARCH.md
  // §6) — appended to the "Web Search is in progress" collapsible block.
  if (env.kind === 'event' && evtType === 'web_search.note') {
    post({
      type: 'web_search_note',
      toolCallId: String(env.payload.tool_call_id ?? ''),
      text: String(env.payload.text ?? ''),
    });
    return true;
  }

  if (env.kind === 'event' && evtType === 'agent.tool_call_detail') {
    const rawDiff = env.payload.diff as Record<string, unknown> | null | undefined;
    const diff =
      rawDiff && typeof rawDiff === 'object'
        ? {
            label: String(rawDiff.label ?? ''),
            prevPath: String(rawDiff.prev_path ?? ''),
            newPath: String(rawDiff.new_path ?? ''),
          }
        : null;
    const rawCheckpoint = env.payload.checkpoint as Record<string, unknown> | null | undefined;
    const checkpoint =
      rawCheckpoint && typeof rawCheckpoint === 'object'
        ? {
            root: String(rawCheckpoint.root ?? ''),
            sha: String(rawCheckpoint.sha ?? ''),
            parent: String(rawCheckpoint.parent ?? ''),
            index: typeof rawCheckpoint.index === 'number' ? rawCheckpoint.index : 0,
            current_index: typeof rawCheckpoint.current_index === 'number' ? rawCheckpoint.current_index : 0,
            undone: rawCheckpoint.undone === true,
          }
        : null;
    post({
      type: 'tool_call_detail',
      toolCallId: String(env.payload.tool_call_id ?? ''),
      detailFile: typeof env.payload.file === 'string' ? env.payload.file : null,
      rows: Array.isArray(env.payload.rows) ? env.payload.rows : [],
      schemaCompliance: typeof env.payload.schema_compliance === 'boolean' ? env.payload.schema_compliance : null,
      success: typeof env.payload.success === 'boolean' ? env.payload.success : null,
      diff,
      checkpoint,
    });
    return true;
  }

  if (env.kind === 'event' && evtType === 'tool.incompliant') {
    const externalName = String(env.payload.external_name ?? 'A tool');
    const desc = String(env.payload.user_description ?? '');
    const internalName = String(env.payload.tool_name ?? '');
    void vscode.window.showErrorMessage(
      `Kōdo: the "${externalName}" tool returned output that does not match its declared ` +
        `schema, so Kōdo had to repair it.${desc ? ` (${desc})` : ''} ` +
        `Internal tool name: ${internalName}.`,
    );
    return true;
  }

  if (env.kind === 'event' && evtType === 'context.compacted') {
    post({
      type: 'context_compacted',
      summaryExcerpt: String(env.payload.summary_excerpt ?? ''),
      summary: String(env.payload.summary ?? env.payload.summary_excerpt ?? ''),
      tokensBefore: Number(env.payload.tokens_before ?? 0),
      tokensAfter: Number(env.payload.tokens_after ?? 0),
    });
    return true;
  }

  if (env.kind === 'event' && evtType === 'checkpoint.state') {
    const rawEntries = Array.isArray(env.payload.entries) ? (env.payload.entries as Record<string, unknown>[]) : [];
    post({
      type: 'checkpoint_state',
      root: String(env.payload.root ?? ''),
      currentIndex: Number(env.payload.current_index ?? -1),
      entries: rawEntries.map((e) => ({ sha: String(e.sha ?? ''), undone: e.undone === true })),
    });
    return true;
  }

  if (env.kind === 'event' && evtType === 'security.rule_added') {
    const scope = env.payload.scope === 'global' ? 'global' : 'session';
    post({
      type: 'security_rule_added',
      scope,
      offer: {
        executable: String(env.payload.executable ?? ''),
        subcommand: String(env.payload.subcommand ?? ''),
      },
    });
    return true;
  }

  if (env.kind === 'event' && evtType === 'agent.unstuck_nudge') {
    const rawReasons = Array.isArray(env.payload.reasons) ? env.payload.reasons : [];
    post({
      type: 'agent_unstuck_nudge',
      note: String(env.payload.note ?? ''),
      reasons: rawReasons.map((r) => String(r)),
      mode: String(env.payload.mode ?? ''),
    });
    return true;
  }

  if (env.kind === 'event' && evtType === 'agent.stuck_critical') {
    post({ type: 'agent_stuck_critical', message: String(env.payload.message ?? '') });
    return true;
  }

  if (env.kind === 'event' && evtType === 'agent.cyclic_thinking_notice') {
    post({ type: 'cyclic_thinking_notice', message: String(env.payload.message ?? '') });
    return true;
  }

  if (env.kind === 'event' && evtType === 'agent.cyclic_thinking_critical') {
    post({
      type: 'agent_cyclic_thinking_critical',
      message: String(env.payload.message ?? ''),
    });
    return true;
  }

  if (env.kind === 'event' && evtType === 'session.greeting') {
    // A brand-new session's opening greeting (kodo.titling.generate_greeting),
    // fired once from a background task shortly after connect — see
    // kodo/doc/WS_PROTOCOL.md §5.9i. Replaces this extension's own previously
    // hardcoded empty-state placeholder.
    post({ type: 'greeting', text: String(env.payload.text ?? '') });
    return true;
  }

  if (env.kind === 'event' && evtType === 'error') {
    const message = String(env.payload.message ?? 'Unknown server error');
    const recoverable = Boolean(env.payload.recoverable ?? true);
    // Anchor the failure in the feed as an error card (survives, tied to where
    // it happened) AND raise a toast. Previously a recoverable error was
    // dropped entirely — no toast, nothing in the feed — so an aborted turn
    // (e.g. an LLM 404) failed completely silently.
    post({ type: 'runtime_error', message, recoverable });
    if (recoverable) {
      void vscode.window.showWarningMessage(`Kōdo: ${message}`);
    } else {
      void vscode.window.showErrorMessage(
        `Kōdo: an error occurred and the workflow cannot proceed — ${message}`,
      );
    }
    return true;
  }

  return false;
}
