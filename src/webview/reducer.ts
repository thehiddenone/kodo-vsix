import type { State, Action, SessionEntry, ToolCallDetailRow, DiffLinkData } from './types';
export function commitStreaming(state: State): SessionEntry[] {
  let session = state.session;
  if (state.streamingThinking) {
    const durationMs = state.thinkingStartedAt !== null ? Date.now() - state.thinkingStartedAt : null;
    session = [...session, { type: 'thinking_block', content: state.streamingThinking, durationMs, exclude_from_context: true }];
  }
  if (state.streamingTokens) {
    session = [...session, { type: 'assistant_response', content: state.streamingTokens, exclude_from_context: false }];
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
      // The tool call is now fully assembled, so any in-progress "Generating…"
      // indicator is done: bake its elapsed time into the entry as
      // "Generated <tool> in Xm Ys" and clear the transient streaming state.
      const toolgenDurationMs =
        state.toolgenActive && state.toolgenStartedAt !== null ? Date.now() - state.toolgenStartedAt : null;
      const toolgenChars = state.toolgenActive ? state.streamingToolgen.length : null;
      return {
        ...state,
        session: [...state.session, { type: 'tool_call', toolName: action.toolName, description: action.description, toolCallId: action.toolCallId, rows: [], detailFile: null, schemaCompliance: null, success: null, timeoutSeconds: action.timeoutSeconds, startedAt: Date.now(), diff: null, toolgenDurationMs, toolgenChars, exclude_from_context: false }],
        streamingToolgen: '',
        toolgenActive: false,
        toolgenToolName: '',
        toolgenStartedAt: null,
      };
    }
    case 'tool_call_detail': {
      // Attach the detail to the matching tool_call entry (most recent match).
      let patched = false;
      const session = [...state.session];
      for (let i = session.length - 1; i >= 0; i--) {
        const e = session[i];
        if (e.type === 'tool_call' && e.toolCallId === action.toolCallId) {
          session[i] = { ...e, rows: action.rows, detailFile: action.detailFile, schemaCompliance: action.schemaCompliance, success: action.success, diff: action.diff };
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
        session: [...state.session, { type: 'user_message', content: action.text, attachments: state.attachedFiles.map((f) => ({ name: f.name, path: f.path })), exclude_from_context: false }],
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
        session: [{ type: 'user_message', content: action.text, attachments: [], exclude_from_context: false }],
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
    case 'question_request':
      return {
        ...state,
        pendingQuestion: {
          requestId: action.requestId,
          question: action.question,
          mode: action.mode,
          choices: action.choices,
        },
        streaming: false,
      };
    case 'question_cleared':
      return { ...state, pendingQuestion: null };
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
        running: action.running,
      };
    case 'resume_offer':
      return { ...state, resumeSessionId: action.sessionId };
    case 'resume_dismissed':
      return { ...state, resumeSessionId: null };
    case 'post_update':
      return {
        ...state,
        session: [...state.session, { type: 'post_update', content: action.message, exclude_from_context: true }],
      };
    case 'session_history': {
      if (state.session.length > 0) {
        return state;
      }
      const entries: SessionEntry[] = [];
      for (const e of action.entries) {
        const type = String(e.type ?? '');
        if (type === 'user_message') {
          // The server persists attachments as links (name + absolute path of
          // the session's stored copy), never inline content, so rebuild the
          // clickable chips from those links.
          const rawAtts = Array.isArray(e.attachments) ? e.attachments : [];
          const attachments = rawAtts.map((a) => {
            const rec = a as Record<string, unknown>;
            return { name: String(rec.name ?? ''), path: String(rec.path ?? '') };
          });
          entries.push({ type, content: String(e.content ?? ''), attachments, exclude_from_context: false });
        } else if (type === 'assistant_response') {
          entries.push({ type, content: String(e.content ?? ''), exclude_from_context: false });
        } else if (type === 'thinking_block') {
          entries.push({ type: 'thinking_block', content: String(e.content ?? ''), durationMs: typeof e.durationMs === 'number' ? e.durationMs : null, exclude_from_context: true });
        } else if (type === 'tool_call') {
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
          entries.push({
            type: 'tool_call',
            toolName: String(e.toolName ?? ''),
            description: String(e.description ?? ''),
            toolCallId: String(e.toolCallId ?? ''),
            rows,
            detailFile: typeof e.detailFile === 'string' ? e.detailFile : null,
            schemaCompliance: typeof e.schemaCompliance === 'boolean' ? e.schemaCompliance : null,
            success: typeof e.success === 'boolean' ? e.success : null,
            // History: the call already finished, so no live progress bar.
            timeoutSeconds: null,
            startedAt: null,
            diff,
            // Generation timing is a live-only nicety; not persisted to history.
            toolgenDurationMs: null,
            toolgenChars: null,
            exclude_from_context: false,
          });
        } else if (type === 'subagent_task') {
          entries.push({ type: 'subagent_task', content: String(e.content ?? ''), exclude_from_context: true });
        } else if (type === 'subsession_start' || type === 'subsession_end') {
          entries.push({
            type: 'subsession_divider',
            phase: type === 'subsession_start' ? 'start' : 'end',
            displayName: String(e.displayName ?? ''),
            parentDisplayName: String(e.parentDisplayName ?? ''),
            failed: e.failed === true,
            exclude_from_context: true,
          });
        } else if (type === 'context_compacted') {
          entries.push({
            type: 'compaction_divider',
            summaryExcerpt: String(e.summaryExcerpt ?? ''),
            summary: String(e.summary ?? e.summaryExcerpt ?? ''),
            tokensBefore: typeof e.tokensBefore === 'number' ? e.tokensBefore : 0,
            tokensAfter: typeof e.tokensAfter === 'number' ? e.tokensAfter : 0,
            exclude_from_context: true,
          });
        }
      }
      return { ...state, session: entries };
    }
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
  autonomous: false,
  effectiveAutonomous: false,
  workflowMode: 'problem_solving',
  effectiveWorkflowMode: 'problem_solving',
  editControl: 'smart',
  commandControl: 'smart',
  editCommandLocked: false,
  running: false,
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
};
