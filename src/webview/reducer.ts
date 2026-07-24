import type { State, Action, SessionEntry, ToolCallDetailRow, DiffLinkData, CheckpointData, AskUserQuestion, AskUserAnswer, FileReviewFeedbackEntry } from './types';
import { DEFAULT_UI_SETTINGS } from './types';

/** Parse a history entry's ISO-8601 `ts` (kodo doc/WS_PROTOCOL.md §5.11) into
 *  epoch ms, or null when absent/unparseable — never thrown from history
 *  hydration over a missing/malformed field. */
function parseTs(value: unknown): number | null {
  if (typeof value !== 'string') {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/** Shared, mutable bookkeeping threaded through every `wireEntryToSessionEntry`
 *  call while processing one `session_history` delivery — populated from BOTH
 *  the main entries and every spliced-in subsession's entries, so the
 *  `liveOnly` carry-forward below can tell a genuinely-still-in-flight
 *  tool_call/ask_user (not yet in either file) from one already covered by
 *  history, regardless of which file it came from. */
interface HistoryConversionContext {
  historicalToolCallIds: Set<string>;
  historicalAskUserIds: Set<string>;
  localAnswers: Map<string, AskUserAnswer[]>;
}

/**
 * Convert one wire history entry (from either the main `entries` array or a
 * subsession's own array — both use the identical shapes) into a
 * `SessionEntry`, or `null` for a divider/unrecognized type the caller
 * handles itself. Factored out so the main log and every subsession's log
 * are rendered by the exact same logic — the server hydrates one file at a
 * time (doc/SESSIONS.md), and this is the client's one-time, unambiguous
 * placement of that content, never a guess-based merge.
 */
function wireEntryToSessionEntry(e: Record<string, unknown>, ctx: HistoryConversionContext): SessionEntry | null {
  const type = String(e.type ?? '');
  if (type === 'user_message') {
    // The server persists attachments as links (name + absolute path of the
    // session's stored copy), never inline content, so rebuild the clickable
    // chips from those links.
    const rawAtts = Array.isArray(e.attachments) ? e.attachments : [];
    const attachments = rawAtts.map((a) => {
      const rec = a as Record<string, unknown>;
      return { name: String(rec.name ?? ''), path: String(rec.path ?? '') };
    });
    return { type: 'user_message', content: String(e.content ?? ''), attachments, ts: parseTs(e.ts), exclude_from_context: false };
  }
  if (type === 'assistant_response') {
    return { type: 'assistant_response', content: String(e.content ?? ''), ts: parseTs(e.ts), exclude_from_context: false };
  }
  if (type === 'thinking_block') {
    return { type: 'thinking_block', content: String(e.content ?? ''), durationMs: typeof e.durationMs === 'number' ? e.durationMs : null, exclude_from_context: true };
  }
  if (type === 'status_response') {
    // Persisted "Kodo responded in..." row (kodo doc/SESSIONS.md's `usage`
    // marker) — part of history in its correct chronological position, so no
    // live-state splicing is needed for it (see the liveOnly filter below,
    // which no longer carries this type).
    return {
      type: 'status_response',
      durationMs: typeof e.durationMs === 'number' ? e.durationMs : 0,
      inputTokens: typeof e.inputTokens === 'number' ? e.inputTokens : 0,
      outputTokens: typeof e.outputTokens === 'number' ? e.outputTokens : 0,
      contextTokens: typeof e.contextTokens === 'number' ? e.contextTokens : 0,
      exclude_from_context: true,
    };
  }
  if (type === 'tool_call') {
    const rawRows = Array.isArray(e.rows) ? e.rows : [];
    const rows: ToolCallDetailRow[] = rawRows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        name: String(row.name ?? ''),
        value: String(row.value ?? ''),
        source: row.source === 'output' ? 'output' : 'input',
        visibility: row.visibility === 'always' ? 'always' : 'visible',
      };
    });
    const rawDiff = e.diff as Record<string, unknown> | null | undefined;
    const diff: DiffLinkData | null =
      rawDiff && typeof rawDiff === 'object'
        ? {
            label: String(rawDiff.label ?? ''),
            prevPath: String(rawDiff.prevPath ?? ''),
            newPath: String(rawDiff.newPath ?? ''),
          }
        : null;
    const rawCheckpoint = e.checkpoint as Record<string, unknown> | null | undefined;
    const checkpoint: CheckpointData | null =
      rawCheckpoint && typeof rawCheckpoint === 'object'
        ? {
            root: String(rawCheckpoint.root ?? ''),
            sha: String(rawCheckpoint.sha ?? ''),
            parent: String(rawCheckpoint.parent ?? ''),
            index: typeof rawCheckpoint.index === 'number' ? rawCheckpoint.index : 0,
            currentIndex: typeof rawCheckpoint.current_index === 'number' ? rawCheckpoint.current_index : 0,
            undone: rawCheckpoint.undone === true,
          }
        : null;
    const toolCallId = String(e.toolCallId ?? '');
    ctx.historicalToolCallIds.add(toolCallId);
    const rawNotes = Array.isArray(e.webSearchNotes) ? e.webSearchNotes : [];
    return {
      type: 'tool_call',
      toolName: String(e.toolName ?? ''),
      description: String(e.description ?? ''),
      toolCallId,
      ts: parseTs(e.ts),
      rows,
      detailFile: typeof e.detailFile === 'string' ? e.detailFile : null,
      schemaCompliance: typeof e.schemaCompliance === 'boolean' ? e.schemaCompliance : null,
      success: typeof e.success === 'boolean' ? e.success : null,
      // History: the call already finished, so no live progress bar.
      timeoutSeconds: null,
      startedAt: null,
      diff,
      checkpoint,
      // Generation timing is a live-only nicety; not persisted to history.
      toolgenDurationMs: null,
      toolgenChars: null,
      webSearchNotes: rawNotes.map(String),
      exclude_from_context: false,
    };
  }
  if (type === 'ask_user') {
    const toolCallId = String(e.toolCallId ?? '');
    ctx.historicalAskUserIds.add(toolCallId);
    const rawQuestions = Array.isArray(e.questions) ? e.questions : [];
    const questions: AskUserQuestion[] = rawQuestions.map((q) => {
      const rec = q as Record<string, unknown>;
      return {
        question: String(rec.question ?? ''),
        kind: rec.kind === 'multi_choice' ? 'multi_choice' : 'single_choice',
        options: Array.isArray(rec.options) ? rec.options.map((o) => String(o)) : [],
      };
    });
    const rawAnswers = Array.isArray(e.answers) ? e.answers : null;
    const answers: AskUserAnswer[] | null =
      rawAnswers?.map((a) => {
        const rec = a as Record<string, unknown>;
        return {
          selected: Array.isArray(rec.selected) ? rec.selected.map((s) => String(s)) : [],
          free_text: typeof rec.free_text === 'string' ? rec.free_text : null,
        };
      }) ?? ctx.localAnswers.get(toolCallId) ?? null;
    return { type: 'ask_user', toolCallId, questions, answers, exclude_from_context: false };
  }
  if (type === 'subagent_task') {
    return { type: 'subagent_task', content: String(e.content ?? ''), exclude_from_context: true };
  }
  if (type === 'interrupted') {
    // Replay of the server's stopped-turn notice (see
    // WorkflowEngine.__persist_interrupted_turn) — same callout the live
    // 'interrupted' action renders, so a reload shows it exactly where the
    // Stop happened instead of dropping it from history.
    return { type: 'interrupted', exclude_from_context: true };
  }
  if (type === 'context_compacted') {
    return {
      type: 'compaction_divider',
      summaryExcerpt: String(e.summaryExcerpt ?? ''),
      summary: String(e.summary ?? e.summaryExcerpt ?? ''),
      tokensBefore: typeof e.tokensBefore === 'number' ? e.tokensBefore : 0,
      tokensAfter: typeof e.tokensAfter === 'number' ? e.tokensAfter : 0,
      exclude_from_context: true,
    };
  }
  if (type === 'runtime_error') {
    // Replay of the server's persisted "error" marker (see
    // EngineEmitters.emit_error) — same card the live 'runtime_error' action
    // renders, so a reload doesn't lose the failure notice.
    return {
      type: 'error_notice',
      message: String(e.message ?? ''),
      recoverable: e.recoverable !== false,
      exclude_from_context: true,
    };
  }
  if (type === 'security_rule_added') {
    // Replay of the server's persisted "security_rule_added" marker (see
    // EngineEmitters.emit_security_rule_added) — same card the live action
    // renders, so a reload doesn't lose the record.
    return {
      type: 'security_rule_added',
      scope: e.scope === 'global' ? 'global' : 'session',
      offer: { executable: String(e.executable ?? ''), subcommand: String(e.subcommand ?? '') },
      exclude_from_context: true,
    };
  }
  if (type === 'agent_unstuck_nudge') {
    // Replay of a persisted "agent_unstuck_nudge"-kind message
    // (doc/STUCK_DETECTION.md) — same notice the live 'agent_unstuck_nudge'
    // action renders, so a reload doesn't lose the record of why the agent
    // kept going.
    const reasons = Array.isArray(e.reasons) ? e.reasons.map((r) => String(r)) : [];
    return {
      type: 'agent_unstuck_nudge',
      note: String(e.note ?? ''),
      reasons,
      mode: String(e.mode ?? ''),
      exclude_from_context: true,
    };
  }
  if (type === 'agent_stuck_critical') {
    // Replay of the server's persisted "agent_stuck_critical" marker (see
    // EngineEmitters.emit_agent_stuck_critical) — same callout the live
    // 'agent_stuck_critical' action renders, so a reload doesn't lose the
    // record of why the watchdog stopped trying.
    return {
      type: 'agent_stuck_critical',
      message: String(e.message ?? ''),
      exclude_from_context: true,
    };
  }
  if (type === 'cyclic_thinking_notice') {
    // Replay of a persisted "cyclic_thinking_notice"-kind message
    // (doc/STUCK_DETECTION.md §2.7) — same notice the live
    // 'cyclic_thinking_notice' action renders, so a reload doesn't lose the
    // record of the detected repetition loop.
    return {
      type: 'cyclic_thinking_notice',
      message: String(e.message ?? ''),
      exclude_from_context: true,
    };
  }
  if (type === 'agent_cyclic_thinking_critical') {
    // Replay of the server's persisted "agent_cyclic_thinking_critical"
    // marker (see EngineEmitters.emit_cyclic_thinking_critical) — same
    // callout the live 'agent_cyclic_thinking_critical' action renders.
    return {
      type: 'agent_cyclic_thinking_critical',
      message: String(e.message ?? ''),
      exclude_from_context: true,
    };
  }
  return null;
}

export function commitStreaming(state: State): SessionEntry[] {
  let session = state.session;
  if (state.streamingThinking) {
    const durationMs = state.thinkingStartedAt !== null ? Date.now() - state.thinkingStartedAt : null;
    session = [...session, { type: 'thinking_block', content: state.streamingThinking, durationMs, exclude_from_context: true }];
  }
  if (state.streamingTokens) {
    session = [...session, { type: 'assistant_response', content: state.streamingTokens, ts: Date.now(), exclude_from_context: false }];
  }
  return session;
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'workspace_status':
      return { ...state, hasWorkspace: action.hasWorkspace };
    case 'status':
      return { ...state, connected: action.connected };
    case 'session_name':
      return { ...state, sessionName: action.name, namingSession: false };
    case 'current_project':
      return { ...state, currentProject: action.name };
    case 'session_naming':
      return { ...state, namingSession: action.active };
    case 'session_cleared':
      // Wipe the visible feed + all transient streaming state (the session is
      // being deleted). Connection/mode/header fields are left as-is.
      return {
        ...state,
        session: [],
        streamingTokens: '',
        streamingThinking: '',
        thinkingActive: false,
        thinkingStartedAt: null,
        streaming: false,
        awaitingLlm: false,
        llmWaiting: null,
        streamingToolgen: '',
        toolgenActive: false,
        toolgenToolName: '',
        toolgenStartedAt: null,
        fileEvents: [],
        pendingGate: null,
        pendingQuestion: null,
        pendingPermission: null,
        pendingStuckAlert: null,
        pendingFileReview: null,
        fileReviewSelection: null,
        fileReviewDrafts: [],
        fileReviewComposer: null,
        namingSession: false,
        attachedFiles: [],
      };
    case 'attachment_added':
      // Host validated the file and assigned it an id; show its chip.
      if (state.attachedFiles.some((f) => f.id === action.id)) {
        return state;
      }
      return { ...state, attachedFiles: [...state.attachedFiles, { id: action.id, name: action.name, path: action.path }] };
    case 'attachment_removed':
      return { ...state, attachedFiles: state.attachedFiles.filter((f) => f.id !== action.id) };
    case 'attachments_cleared':
      // Host consumed the staged files (injected them into the submitted prompt).
      return { ...state, attachedFiles: [] };
    case 'sent_attachments': {
      // The server stored the just-sent prompt's attachments and copied them
      // into the session. Retarget the most recent user_message's chips to the
      // durable stored copies (and reflect any the server dropped). Walk from
      // the end so the freshest bubble — the one we optimistically rendered on
      // prompt_sent — is the one updated.
      const idx = [...state.session].reverse().findIndex((e) => e.type === 'user_message');
      if (idx === -1) {
        return state;
      }
      const at = state.session.length - 1 - idx;
      const target = state.session[at];
      if (target.type !== 'user_message') {
        return state;
      }
      const session = [...state.session];
      session[at] = { ...target, attachments: action.attachments };
      return { ...state, session };
    }
    case 'llm_turn_start':
      // A new turn begins; clear any leftover toolgen indicator (e.g. from a
      // cancelled prior turn that never produced a tool_call entry).
      return { ...state, llmWaiting: null, awaitingLlm: true, thinkingStartedAt: null, streamingToolgen: '', toolgenActive: false, toolgenToolName: '', toolgenStartedAt: null };
    case 'llm_waiting':
      return {
        ...state,
        llmWaiting: action.waiting ? { reason: action.reason, retryIn: action.retryIn } : null,
      };
    case 'tool_call': {
      // A buffered live 'tool_call' frame can be replayed after session_history
      // already seeded a (possibly more complete) entry for the same call — a
      // reconnect redelivering a mid-turn frame, not a genuinely new call. Skip
      // the duplicate rather than appending a second card for the same id.
      if (state.session.some((e) => e.type === 'tool_call' && e.toolCallId === action.toolCallId)) {
        return state;
      }
      // The tool call is now fully assembled, so any in-progress "Generating…"
      // indicator is done: bake its elapsed time into the entry as
      // "Generated <tool> in Xm Ys" and clear the transient streaming state.
      const toolgenDurationMs =
        state.toolgenActive && state.toolgenStartedAt !== null ? Date.now() - state.toolgenStartedAt : null;
      const toolgenChars = state.toolgenActive ? state.streamingToolgen.length : null;
      return {
        ...state,
        // startedAt stays null until 'tool_call_in_progress' arrives — the
        // progress bar must not tick through a judging round or permission
        // wait that precedes real execution (see indicators.tsx).
        session: [...state.session, { type: 'tool_call', toolName: action.toolName, description: action.description, toolCallId: action.toolCallId, ts: Date.now(), rows: [], detailFile: null, schemaCompliance: null, success: null, timeoutSeconds: action.timeoutSeconds, startedAt: null, diff: null, checkpoint: null, toolgenDurationMs, toolgenChars, webSearchNotes: [], exclude_from_context: false }],
        streamingToolgen: '',
        toolgenActive: false,
        toolgenToolName: '',
        toolgenStartedAt: null,
      };
    }
    case 'tool_call_in_progress': {
      // Security gate cleared (allowed outright, or the user granted
      // permission) and the tool handler is actually running now — start the
      // run_command timeout clock from here, not from card creation.
      const session = [...state.session];
      for (let i = session.length - 1; i >= 0; i--) {
        const e = session[i];
        if (e.type === 'tool_call' && e.toolCallId === action.toolCallId) {
          session[i] = { ...e, startedAt: Date.now() };
          break;
        }
      }
      return { ...state, session };
    }
    case 'web_search_note': {
      // Append to the matching web_search entry's live narration log
      // (most recent match, mirroring tool_call_in_progress/tool_call_detail).
      let patched = false;
      const session = [...state.session];
      for (let i = session.length - 1; i >= 0; i--) {
        const e = session[i];
        if (e.type === 'tool_call' && e.toolCallId === action.toolCallId) {
          session[i] = { ...e, webSearchNotes: [...e.webSearchNotes, action.text] };
          patched = true;
          break;
        }
      }
      return patched ? { ...state, session } : state;
    }
    case 'tool_call_detail': {
      // Attach the detail to the matching tool_call entry (most recent match).
      let patched = false;
      const session = [...state.session];
      for (let i = session.length - 1; i >= 0; i--) {
        const e = session[i];
        if (e.type === 'tool_call' && e.toolCallId === action.toolCallId) {
          session[i] = { ...e, rows: action.rows, detailFile: action.detailFile, schemaCompliance: action.schemaCompliance, success: action.success, diff: action.diff, checkpoint: action.checkpoint };
          patched = true;
          break;
        }
      }
      return patched ? { ...state, session } : state;
    }
    case 'thinking_token':
      return { ...state, streamingThinking: state.streamingThinking + action.text, thinkingActive: true, thinkingStartedAt: state.thinkingStartedAt ?? Date.now(), awaitingLlm: false };
    case 'token':
      return { ...state, streamingTokens: state.streamingTokens + action.text, streaming: true, thinkingActive: false, awaitingLlm: false, llmWaiting: null };
    case 'toolgen_token': {
      // On the first fragment, commit the visible thinking/text streamed so far
      // (the sentence is complete) so the "Generating…" block sits below it.
      const starting = !state.toolgenActive;
      const session = starting ? commitStreaming(state) : state.session;
      return {
        ...state,
        session,
        streamingTokens: starting ? '' : state.streamingTokens,
        streamingThinking: starting ? '' : state.streamingThinking,
        thinkingActive: false,
        thinkingStartedAt: starting ? null : state.thinkingStartedAt,
        awaitingLlm: false,
        streaming: false,
        toolgenActive: true,
        toolgenToolName: action.toolName || state.toolgenToolName,
        toolgenStartedAt: state.toolgenStartedAt ?? Date.now(),
        streamingToolgen: state.streamingToolgen + action.text,
      };
    }
    case 'stream_end':
      return {
        ...state,
        session: commitStreaming(state),
        streamingTokens: '',
        streamingThinking: '',
        thinkingActive: false,
        thinkingStartedAt: null,
        streaming: false,
        llmWaiting: null,
        // Clear the "Awaiting response" spinner too. It's normally cleared by the
        // first token/thinking delta, but a turn that ends with zero output (e.g.
        // an immediate LLM error) reaches stream_end with it still set — leaving
        // the indicator spinning forever if we don't reset it here.
        awaitingLlm: false,
      };
    case 'pong':
      return { ...state, lastPong: new Date().toLocaleTimeString() };
    case 'stage': {
      const clearStreaming = action.stage !== 'IDLE' && !state.streaming;
      return {
        ...state,
        stage: action.stage,
        agent: action.agent,
        streamingTokens: clearStreaming ? '' : state.streamingTokens,
      };
    }
    case 'prompt_sent':
      // Bake the staged attachments into this user message so the fact that
      // files rode along is preserved in the feed, then clear the staging area.
      return {
        ...state,
        session: [...state.session, { type: 'user_message', content: action.text, attachments: state.attachedFiles.map((f) => ({ name: f.name, path: f.path })), ts: Date.now(), exclude_from_context: false }],
        attachedFiles: [],
        streamingTokens: '',
        streaming: false,
        awaitingLlm: false,
        streamingToolgen: '',
        toolgenActive: false,
        toolgenToolName: '',
        toolgenStartedAt: null,
      };
    case 'restore_prompt':
      if (state.session.length > 0) {
        return state;
      }
      return {
        ...state,
        session: [{ type: 'user_message', content: action.text, attachments: [], ts: Date.now(), exclude_from_context: false }],
      };
    case 'agent_started':
      return { ...state, agent: action.agent };
    case 'agent_finished':
      return { ...state, agent: null };
    case 'subsession_started': {
      // A sub-agent takes over: commit any in-flight main streaming first, then
      // drop a "took over from" divider into the feed, followed by the structured
      // task brief the sub-agent was handed (a distinct card, not a user bubble).
      const baseSession = commitStreaming(state);
      const startEntries: SessionEntry[] = [
        { type: 'subsession_divider', phase: 'start', displayName: action.displayName, parentDisplayName: '', exclude_from_context: true },
      ];
      if (action.task) {
        startEntries.push({ type: 'subagent_task', content: action.task, exclude_from_context: true });
      }
      return {
        ...state,
        session: [...baseSession, ...startEntries],
        streamingTokens: '',
        streamingThinking: '',
        thinkingActive: false,
        thinkingStartedAt: null,
      };
    }
    case 'subsession_ended': {
      const baseSession = commitStreaming(state);
      return {
        ...state,
        session: [
          ...baseSession,
          { type: 'subsession_divider', phase: 'end', displayName: action.displayName, parentDisplayName: action.parentDisplayName, failed: action.failed, exclude_from_context: true },
        ],
        streamingTokens: '',
        streamingThinking: '',
        thinkingActive: false,
        thinkingStartedAt: null,
      };
    }
    case 'usage': {
      const t = action.lastCallTokens;
      if (t === null) {
        return { ...state, cumulativeUsd: action.cumulativeUsd, lastCallTokens: null };
      }
      const baseSession = commitStreaming(state);
      const statusEntry: SessionEntry = {
        type: 'status_response',
        durationMs: action.durationSeconds * 1000,
        inputTokens: t?.input ?? 0,
        outputTokens: t?.output ?? 0,
        contextTokens: (t?.input ?? 0) + (t?.cache_read ?? 0) + (t?.cache_write ?? 0),
        exclude_from_context: true,
      };
      return {
        ...state,
        cumulativeUsd: action.cumulativeUsd,
        lastCallTokens: action.lastCallTokens,
        awaitingLlm: false,
        streamingTokens: '',
        streamingThinking: '',
        thinkingActive: false,
        thinkingStartedAt: null,
        streaming: false,
        session: [...baseSession, statusEntry],
      };
    }
    case 'context_stats':
      return {
        ...state,
        contextStats: {
          currentTokens: action.currentTokens,
          limitTokens: action.limitTokens,
          percent: action.percent,
          canCompact: action.canCompact,
        },
      };
    case 'context_compacting':
      return { ...state, compacting: action.active };
    case 'context_compacted':
      return {
        ...state,
        session: [
          ...commitStreaming(state),
          {
            type: 'compaction_divider',
            summaryExcerpt: action.summaryExcerpt,
            summary: action.summary,
            tokensBefore: action.tokensBefore,
            tokensAfter: action.tokensAfter,
            exclude_from_context: true,
          },
        ],
        streamingTokens: '',
        streamingThinking: '',
        thinkingActive: false,
        thinkingStartedAt: null,
      };
    case 'file_change':
      return {
        ...state,
        fileEvents: [...state.fileEvents, { path: action.path, kind: action.kind }],
      };
    case 'approval_request':
      return {
        ...state,
        pendingGate: {
          gateId: action.gateId,
          gateType: action.gateType,
          summary: action.summary,
          artifactPath: action.artifactPath,
        },
        streaming: false,
      };
    case 'approval_cleared':
      return { ...state, pendingGate: null };
    case 'question_request': {
      // An ask_user batch arrived. The panel entry may already exist in the
      // feed — rebuilt from history (the tool_use is flushed before dispatch),
      // or from an earlier delivery of this same request — so reconcile
      // rather than blindly append. The server is authoritative about
      // pending-ness: a request for an entry the webview considers answered
      // re-opens it (the response never reached the server).
      const base = commitStreaming(state);
      let entryId = action.toolCallId;
      let found = false;
      let session = base.map((e) => {
        if (e.type !== 'ask_user' || found) {
          return e;
        }
        const matches = action.toolCallId
          ? e.toolCallId === action.toolCallId
          : e.answers === null;
        if (!matches) {
          return e;
        }
        found = true;
        entryId = e.toolCallId;
        return {
          ...e,
          questions: action.questions.length > 0 ? action.questions : e.questions,
          answers: null,
        };
      });
      if (!found) {
        entryId = action.toolCallId || action.requestId;
        session = [
          ...session,
          { type: 'ask_user', toolCallId: entryId, questions: action.questions, answers: null, exclude_from_context: false },
        ];
      }
      return {
        ...state,
        session,
        pendingQuestion: { requestId: action.requestId, toolCallId: entryId, questions: action.questions },
        streaming: false,
        streamingTokens: '',
        streamingThinking: '',
        thinkingActive: false,
        thinkingStartedAt: null,
        awaitingLlm: false,
        // The ask_user arguments streamed as a toolgen block; the panel now
        // replaces it (there is no tool_call card for ask_user).
        streamingToolgen: '',
        toolgenActive: false,
        toolgenToolName: '',
        toolgenStartedAt: null,
      };
    }
    case 'question_answered': {
      // Freeze the matching panel with the confirmed answers; it stays
      // visible but read-only from here on (history rebuilds it the same way).
      const session = state.session.map((e) =>
        e.type === 'ask_user' && e.toolCallId === action.toolCallId
          ? { ...e, answers: action.answers }
          : e,
      );
      return { ...state, session, pendingQuestion: null };
    }
    case 'question_cleared':
      return { ...state, pendingQuestion: null };
    case 'permission_request':
      // The security layer wants an allow/deny for one gated tool call. The
      // panel is transient (never a session entry): the gated tool_call card
      // is already in the feed, and its result records the outcome.
      return {
        ...state,
        pendingPermission: {
          requestId: action.requestId,
          toolCallId: action.toolCallId,
          toolName: action.toolName,
          externalName: action.externalName,
          risk: action.risk,
          intent: action.intent,
          reason: action.reason,
          params: action.params,
          recovered: action.recovered,
          parts: action.parts,
        },
        streaming: false,
        awaitingLlm: false,
      };
    case 'permission_cleared':
      return { ...state, pendingPermission: null };
    case 'stuck_alert_request':
      // The stuck-agent watchdog wants to know whether to nudge a stalled
      // agent (doc/STUCK_DETECTION.md). Transient like pendingPermission:
      // once decided, the "unstick" action produces its own
      // agent_unstuck_nudge session entry recording the outcome.
      return {
        ...state,
        pendingStuckAlert: {
          requestId: action.requestId,
          agentName: action.agentName,
          displayName: action.displayName,
          reasons: action.reasons,
        },
        streaming: false,
        awaitingLlm: false,
      };
    case 'stuck_alert_cleared':
      return { ...state, pendingStuckAlert: null };
    case 'file_review_request':
      // Edit Control wants an approve/reject/feedback decision for one
      // create_file/edit_file call before it writes anything
      // (WS_PROTOCOL.md §6.5b). Transient like pendingPermission: the gated
      // tool_call card is already in the feed and its result records the
      // outcome. Any selection left over from a previous review is stale.
      return {
        ...state,
        pendingFileReview: {
          requestId: action.requestId,
          toolCallId: action.toolCallId,
          toolName: action.toolName,
          path: action.path,
          mode: action.mode,
          oldContent: action.oldContent,
          newContent: action.newContent,
        },
        fileReviewSelection: null,
        fileReviewDrafts: [],
        fileReviewComposer: null,
        streaming: false,
        awaitingLlm: false,
      };
    case 'file_review_cleared':
      return {
        ...state,
        pendingFileReview: null,
        fileReviewSelection: null,
        fileReviewDrafts: [],
        fileReviewComposer: null,
      };
    case 'file_review_selection':
      return {
        ...state,
        fileReviewSelection: {
          hasSelection: action.hasSelection,
          lineFrom: action.lineFrom,
          lineTo: action.lineTo,
          targetedCode: action.targetedCode,
        },
      };
    case 'file_review_open_composer': {
      // Sourced from the live selection already pushed by the host — both
      // the in-panel "+ Add feedback" button and the editor/context menu
      // command converge on this same action, no payload needed. No live
      // selection (or an empty one) opens the composer in general-feedback
      // mode instead of refusing — "+ Add feedback" is always enabled now.
      const sel = state.fileReviewSelection;
      return {
        ...state,
        fileReviewComposer:
          sel && sel.hasSelection
            ? { editingIndex: null, generalFeedback: false, lineFrom: sel.lineFrom, lineTo: sel.lineTo, targetedCode: sel.targetedCode, initialText: '' }
            : { editingIndex: null, generalFeedback: true, initialText: '' },
      };
    }
    case 'file_review_edit_draft': {
      const d = state.fileReviewDrafts[action.index];
      if (!d) {
        return state;
      }
      return {
        ...state,
        fileReviewComposer: d.generalFeedback
          ? { editingIndex: action.index, generalFeedback: true, initialText: d.feedback }
          : { editingIndex: action.index, generalFeedback: false, lineFrom: d.lineFrom, lineTo: d.lineTo, targetedCode: d.targetedCode, initialText: d.feedback },
      };
    }
    case 'file_review_close_composer':
      return { ...state, fileReviewComposer: null };
    case 'file_review_apply_draft': {
      const composer = state.fileReviewComposer;
      const text = action.text.trim();
      if (!composer || !text) {
        return state;
      }
      const entry: FileReviewFeedbackEntry = composer.generalFeedback
        ? { generalFeedback: true, feedback: text }
        : { generalFeedback: false, lineFrom: composer.lineFrom, lineTo: composer.lineTo, targetedCode: composer.targetedCode, feedback: text };
      const fileReviewDrafts =
        composer.editingIndex === null
          ? [...state.fileReviewDrafts, entry]
          : state.fileReviewDrafts.map((d, i) => (i === composer.editingIndex ? entry : d));
      return { ...state, fileReviewDrafts, fileReviewComposer: null };
    }
    case 'file_review_remove_draft':
      return {
        ...state,
        fileReviewDrafts: state.fileReviewDrafts.filter((_, i) => i !== action.index),
      };
    case 'agent_unstuck_nudge':
      // The watchdog's continuation nudge just landed — a plain append,
      // mirroring 'security_rule_added': it fires right after the nudge is
      // persisted, before the agent's next turn starts streaming.
      return {
        ...state,
        session: [
          ...state.session,
          {
            type: 'agent_unstuck_nudge',
            note: action.note,
            reasons: action.reasons,
            mode: action.mode,
            exclude_from_context: true,
          },
        ],
      };
    case 'security_rule_added':
      // The user's own record of a just-granted "always allow" rule
      // (WS_PROTOCOL.md §5.9d) — a plain append, mirroring 'tool_call': it
      // fires mid-turn, after any toolgen/token streaming for this call has
      // already committed, so there is no streaming state to fold in here.
      return {
        ...state,
        session: [
          ...state.session,
          { type: 'security_rule_added', scope: action.scope, offer: action.offer, exclude_from_context: true },
        ],
      };
    case 'agent_stuck_critical':
      // The watchdog gave up after one failed nudge (doc/STUCK_DETECTION.md)
      // — a plain append, mirroring 'agent_unstuck_nudge'. The turn has
      // already ended normally by the time this fires, so there is no
      // streaming/awaiting state to clear here.
      return {
        ...state,
        session: [
          ...state.session,
          { type: 'agent_stuck_critical', message: action.message, exclude_from_context: true },
        ],
      };
    case 'cyclic_thinking_notice': {
      // Strike 1 of the mid-stream cyclic-thinking detector
      // (doc/STUCK_DETECTION.md §2.7): unlike 'agent_unstuck_nudge'/
      // 'agent_stuck_critical' above, this does NOT fire after a round ended
      // naturally — the stream was cancelled mid-round, with the repeated
      // thinking content still live in `streamingThinking` (every fragment
      // was forwarded to the client before the detector ever saw it). The
      // turn is not ending either: _run_agent_turn immediately starts round
      // 2, which sends a fresh llm_turn_start (which does NOT clear
      // streamingThinking/streamingTokens) followed by that round's own
      // genuine thinking_token events. Committing+clearing the buffer here
      // (mirroring 'toolgen_token's "starting" branch, which has the same
      // "more streaming is still coming" shape) is what keeps round 2's
      // thinking display from silently inheriting round 1's garbage as a
      // prefix. Deliberately does NOT touch awaitingLlm/streaming/llmWaiting
      // — round 2's imminent llm_turn_start will set those correctly, and
      // clearing them here too would just flicker the "awaiting response"
      // indicator off and back on within one turn.
      const session = commitStreaming(state);
      return {
        ...state,
        session: [
          ...session,
          { type: 'cyclic_thinking_notice', message: action.message, exclude_from_context: true },
        ],
        streamingTokens: '',
        streamingThinking: '',
        thinkingActive: false,
        thinkingStartedAt: null,
      };
    }
    case 'agent_cyclic_thinking_critical': {
      // Strike 2: the entry-agent's thinking hit a *second* detected
      // repetition loop right after the notice above, so the turn ends here
      // for good (no round 3 coming) — unlike strike 1, this DOES mirror
      // 'interrupted'/'runtime_error' fully, clearing every waiting
      // indicator. No dangling tool_call to patch (success === null): a
      // cyclic abort only ever fires within the thinking-delta phase of a
      // round, before any tool call for that round can exist.
      return {
        ...state,
        session: [
          ...commitStreaming(state),
          {
            type: 'agent_cyclic_thinking_critical',
            message: action.message,
            exclude_from_context: true,
          },
        ],
        streamingTokens: '',
        streamingThinking: '',
        thinkingActive: false,
        thinkingStartedAt: null,
        streaming: false,
        awaitingLlm: false,
        llmWaiting: null,
        streamingToolgen: '',
        toolgenActive: false,
        toolgenToolName: '',
        toolgenStartedAt: null,
      };
    }
    case 'mode_state':
      return {
        ...state,
        autonomous: action.autonomous,
        effectiveAutonomous: action.effectiveAutonomous,
        workflowMode: action.workflowMode,
        effectiveWorkflowMode: action.effectiveWorkflowMode,
        editControl: action.editControl,
        commandControl: action.commandControl,
        editCommandLocked: action.editCommandLocked,
        thinkingLevel: action.thinkingLevel,
        thinkingFamily: action.thinkingFamily,
        thinkingTiers: action.thinkingTiers,
        running: action.running,
        workspaceConnected: action.workspaceConnected,
      };
    case 'resume_offer':
      return { ...state, resumeSessionId: action.sessionId };
    case 'resume_dismissed':
      return { ...state, resumeSessionId: null };
    case 'session_history': {
      // Hydration is one file at a time (kodo doc/SESSIONS.md): `action.entries`
      // mirrors the main session log alone — a `subsession_start` there is a
      // divider only, never inline content. `action.subsessions[id]` is that
      // one subsession's own entries, read from exactly its own file. This
      // reducer does the one-time, unambiguous placement of each subsession's
      // block right after its start divider — never a merge of several files
      // pre-flattened by the server, and never a guess based on ids already
      // present in the live feed.
      const historicalToolCallIds = new Set<string>();
      const historicalAskUserIds = new Set<string>();
      // Answers the webview already holds locally (confirmed, response still
      // in flight to the server when it rebuilt history). History is
      // authoritative for everything else, but a null-answered historical
      // panel keeps the local answers unless the server actively re-asks
      // (a replayed prompt.question re-opens it — see question_request).
      const localAnswers = new Map(
        state.session.flatMap((e) =>
          e.type === 'ask_user' && e.answers !== null ? [[e.toolCallId, e.answers] as const] : [],
        ),
      );
      const ctx: HistoryConversionContext = { historicalToolCallIds, historicalAskUserIds, localAnswers };
      const entries: SessionEntry[] = [];
      for (const e of action.entries) {
        const type = String(e.type ?? '');
        if (type === 'subsession_start' || type === 'subsession_end') {
          entries.push({
            type: 'subsession_divider',
            phase: type === 'subsession_start' ? 'start' : 'end',
            displayName: String(e.displayName ?? ''),
            parentDisplayName: String(e.parentDisplayName ?? ''),
            failed: e.failed === true,
            exclude_from_context: true,
          });
          if (type === 'subsession_start') {
            const subsessionId = String(e.subsessionId ?? '');
            const subEntries = action.subsessions[subsessionId] ?? [];
            for (const sub of subEntries) {
              const converted = wireEntryToSessionEntry(sub, ctx);
              if (converted) {
                entries.push(converted);
              }
            }
          }
          continue;
        }
        const converted = wireEntryToSessionEntry(e, ctx);
        if (converted) {
          entries.push(converted);
        }
      }
      // session.history is (re-)sent on every reconnect, including one where
      // the webview never remounted (state.session already reflects the same
      // history plus more) — so this cannot simply replace state.session,
      // only reconcile: history (main log + every spliced subsession) is
      // authoritative for everything it can represent. What it can never
      // represent — a genuinely dangling `tool_call`/`ask_user` still in
      // flight in the currently active subsession, which only persists at
      // turn boundaries — still rides along after it, unchanged.
      const liveOnly = state.session.filter(
        (e) =>
          (e.type === 'tool_call' && !historicalToolCallIds.has(e.toolCallId)) ||
          (e.type === 'ask_user' && !historicalAskUserIds.has(e.toolCallId)),
      );
      return { ...state, session: [...entries, ...liveOnly] };
    }
    case 'interrupted': {
      // The user clicked Stop mid-turn (server phase -> "stopped"). Commit any
      // partial streaming text, mark whatever tool call was still in flight
      // (success === null) as not completed so its run_command progress bar
      // and pending badge disappear, silence every other "waiting" indicator,
      // and drop a callout into the feed.
      const baseSession = commitStreaming(state).map((e) =>
        e.type === 'tool_call' && e.success === null ? { ...e, success: false, startedAt: null } : e,
      );
      return {
        ...state,
        session: [...baseSession, { type: 'interrupted', exclude_from_context: true }],
        streamingTokens: '',
        streamingThinking: '',
        thinkingActive: false,
        thinkingStartedAt: null,
        streaming: false,
        awaitingLlm: false,
        llmWaiting: null,
        streamingToolgen: '',
        toolgenActive: false,
        toolgenToolName: '',
        toolgenStartedAt: null,
        compacting: false,
      };
    }
    case 'runtime_error': {
      // A server-side runtime error (EVT_ERROR) aborted the turn. Mirror the
      // 'interrupted' handling: commit any partial streaming text, mark a tool
      // call still in flight as failed, silence every "waiting" indicator (so
      // the "Awaiting response" spinner and progress bars stop), and anchor the
      // failure in the feed as an error card so it is never silent.
      const baseSession = commitStreaming(state).map((e) =>
        e.type === 'tool_call' && e.success === null ? { ...e, success: false, startedAt: null } : e,
      );
      return {
        ...state,
        session: [
          ...baseSession,
          { type: 'error_notice', message: action.message, recoverable: action.recoverable, exclude_from_context: true },
        ],
        streamingTokens: '',
        streamingThinking: '',
        thinkingActive: false,
        thinkingStartedAt: null,
        streaming: false,
        awaitingLlm: false,
        llmWaiting: null,
        streamingToolgen: '',
        toolgenActive: false,
        toolgenToolName: '',
        toolgenStartedAt: null,
        compacting: false,
      };
    }
    case 'checkpoint_state': {
      // One undo/redo/rollback/roll-forward can change every other checkpoint
      // entry's eligible action for this root (the current pointer moved), so
      // refresh every tool_call entry sharing `root` in one pass.
      let changed = false;
      const session = state.session.map((e) => {
        if (e.type !== 'tool_call' || e.checkpoint === null || e.checkpoint.root !== action.root) {
          return e;
        }
        const index = action.entries.findIndex((en) => en.sha === e.checkpoint!.sha);
        if (index === -1) {
          return e;
        }
        changed = true;
        return {
          ...e,
          checkpoint: {
            ...e.checkpoint,
            index,
            currentIndex: action.currentIndex,
            undone: action.entries[index].undone,
          },
        };
      });
      return changed ? { ...state, session } : state;
    }
    case 'ui_settings':
      return {
        ...state,
        uiSettings: { showTimestamps: action.showTimestamps, timezone: action.timezone, clockFormat: action.clockFormat },
      };
    default:
      return state;
  }
}

export const initial: State = {
  connected: false,
  hasWorkspace: false,
  sessionName: '',
  currentProject: '',
  namingSession: false,
  stage: 'IDLE',
  agent: null,
  session: [],
  streamingTokens: '',
  streamingThinking: '',
  thinkingActive: false,
  thinkingStartedAt: null,
  streaming: false,
  lastPong: null,
  cumulativeUsd: 0,
  lastCallTokens: null,
  fileEvents: [],
  pendingGate: null,
  pendingQuestion: null,
  pendingPermission: null,
  pendingStuckAlert: null,
  pendingFileReview: null,
  fileReviewSelection: null,
  fileReviewDrafts: [],
  fileReviewComposer: null,
  autonomous: false,
  effectiveAutonomous: false,
  workflowMode: 'problem_solving',
  effectiveWorkflowMode: 'problem_solving',
  editControl: 'smart',
  commandControl: 'smart',
  editCommandLocked: false,
  thinkingLevel: '',
  thinkingFamily: null,
  thinkingTiers: [],
  running: false,
  workspaceConnected: true,
  resumeSessionId: null,
  awaitingLlm: false,
  llmWaiting: null,
  streamingToolgen: '',
  toolgenActive: false,
  toolgenToolName: '',
  toolgenStartedAt: null,
  attachedFiles: [],
  contextStats: null,
  compacting: false,
  uiSettings: DEFAULT_UI_SETTINGS,
};
