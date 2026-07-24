import { useEffect, useReducer, useRef } from 'preact/hooks';
import { vscode } from './vscode';
import { styles } from './styles';
import type { LastCallTokens, ToolCallDetailRow, DiffLinkData, CheckpointData, AskUserQuestion, AskUserAnswer, PermissionParamRow, PermissionPart } from './types';
import { coerceEditControl, coerceCommandControl, coerceClockFormatPreset } from './types';
import { reducer, initial } from './reducer';
import { ResumeBanner } from './ResumeBanner';
import { UsagePanel } from './UsagePanel';
import { SessionEntryView } from './SessionEntryView';
import { ThinkingBlock, ToolgenBlock } from './StreamingBlocks';
import { Markdown } from './markdown';
import { AwaitingIndicator, LlmWaitingIndicator, NamingIndicator, CompactingIndicator } from './indicators';
import { FileEventList } from './FileEventList';
import { ApprovalGate } from './gates';
import { AskUserPanel } from './AskUserPanel';
import { PermissionPanel } from './PermissionPanel';
import { StuckAlertPanel } from './StuckAlertPanel';
import { FileReviewPanel } from './FileReviewPanel';
import { ModeControls } from './ModeControls';
import { AttachedFilesArea } from './AttachedFilesArea';
import { FooterButton } from './FooterButton';
export function App() {
  const [state, dispatch] = useReducer(reducer, initial);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const msg = event.data as Record<string, unknown>;
      switch (msg.type) {
        case 'workspace_status':
          dispatch({ type: 'workspace_status', hasWorkspace: Boolean(msg.hasWorkspace) });
          break;
        case 'status':
          dispatch({ type: 'status', connected: Boolean(msg.connected) });
          break;
        case 'session_name':
          dispatch({ type: 'session_name', name: String(msg.name ?? '') });
          break;
        case 'current_project':
          dispatch({ type: 'current_project', name: String(msg.name ?? '') });
          break;
        case 'session_naming':
          dispatch({ type: 'session_naming', active: Boolean(msg.active) });
          break;
        case 'session_cleared':
          dispatch({ type: 'session_cleared' });
          break;
        case 'attachment_added':
          dispatch({ type: 'attachment_added', id: String(msg.id ?? ''), name: String(msg.name ?? ''), path: String(msg.path ?? '') });
          break;
        case 'attachments_cleared':
          dispatch({ type: 'attachments_cleared' });
          break;
        case 'sent_attachments': {
          const raw = Array.isArray(msg.attachments) ? msg.attachments : [];
          const attachments = raw.map((a) => {
            const rec = a as Record<string, unknown>;
            return { name: String(rec.name ?? ''), path: String(rec.path ?? '') };
          });
          dispatch({ type: 'sent_attachments', attachments });
          break;
        }
        case 'token':
          dispatch({ type: 'token', text: String(msg.text ?? '') });
          break;
        case 'thinking_token':
          dispatch({ type: 'thinking_token', text: String(msg.text ?? '') });
          break;
        case 'toolgen_token':
          dispatch({ type: 'toolgen_token', toolName: String(msg.toolName ?? ''), text: String(msg.text ?? '') });
          break;
        case 'stream_end':
          dispatch({ type: 'stream_end' });
          break;
        case 'interrupted':
          dispatch({ type: 'interrupted' });
          break;
        case 'runtime_error':
          dispatch({ type: 'runtime_error', message: String(msg.message ?? 'Unknown server error'), recoverable: Boolean(msg.recoverable ?? true) });
          break;
        case 'security_rule_added': {
          const offer = (msg.offer ?? {}) as Record<string, unknown>;
          dispatch({
            type: 'security_rule_added',
            scope: msg.scope === 'global' ? 'global' : 'session',
            offer: { executable: String(offer.executable ?? ''), subcommand: String(offer.subcommand ?? '') },
          });
          break;
        }
        case 'pong':
          dispatch({ type: 'pong' });
          break;
        case 'stage':
          dispatch({
            type: 'stage',
            stage: String(msg.stage ?? 'IDLE'),
            agent: msg.agent ? String(msg.agent) : null,
          });
          break;
        case 'agent_started':
          dispatch({ type: 'agent_started', agent: String(msg.agent ?? '') });
          break;
        case 'agent_finished':
          dispatch({ type: 'agent_finished', agent: String(msg.agent ?? '') });
          break;
        case 'subsession_started':
          dispatch({ type: 'subsession_started', displayName: String(msg.displayName ?? ''), task: String(msg.task ?? '') });
          break;
        case 'subsession_ended':
          dispatch({
            type: 'subsession_ended',
            displayName: String(msg.displayName ?? ''),
            parentDisplayName: String(msg.parentDisplayName ?? ''),
            failed: msg.failed === true,
          });
          break;
        case 'llm_turn_start':
          dispatch({ type: 'llm_turn_start' });
          break;
        case 'llm_waiting':
          dispatch({
            type: 'llm_waiting',
            waiting: Boolean(msg.waiting),
            reason: String(msg.reason ?? 'queued'),
            retryIn: typeof msg.retryIn === 'number' ? msg.retryIn : null,
          });
          break;
        case 'session_history':
          dispatch({
            type: 'session_history',
            entries: (msg.entries as Record<string, unknown>[]) ?? [],
            subsessions: (msg.subsessions as Record<string, Record<string, unknown>[]>) ?? {},
          });
          break;
        case 'tool_call':
          dispatch({ type: 'tool_call', toolName: String(msg.toolName ?? ''), description: String(msg.description ?? ''), toolCallId: String(msg.toolCallId ?? ''), timeoutSeconds: typeof msg.timeoutSeconds === 'number' ? msg.timeoutSeconds : null });
          break;
        case 'tool_call_in_progress':
          dispatch({ type: 'tool_call_in_progress', toolCallId: String(msg.toolCallId ?? '') });
          break;
        case 'web_search_note':
          dispatch({
            type: 'web_search_note',
            toolCallId: String(msg.toolCallId ?? ''),
            text: String(msg.text ?? ''),
          });
          break;
        case 'tool_call_detail': {
          const rawRows = Array.isArray(msg.rows) ? (msg.rows as Record<string, unknown>[]) : [];
          const rows: ToolCallDetailRow[] = rawRows.map((row) => ({
            name: String(row.name ?? ''),
            value: String(row.value ?? ''),
            source: row.source === 'output' ? 'output' : 'input',
            visibility: row.visibility === 'always' ? 'always' : 'visible',
          }));
          const rawDiff = msg.diff as Record<string, unknown> | null | undefined;
          const diff: DiffLinkData | null =
            rawDiff && typeof rawDiff === 'object'
              ? {
                  label: String(rawDiff.label ?? ''),
                  prevPath: String(rawDiff.prevPath ?? ''),
                  newPath: String(rawDiff.newPath ?? ''),
                }
              : null;
          const rawCheckpoint = msg.checkpoint as Record<string, unknown> | null | undefined;
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
          dispatch({
            type: 'tool_call_detail',
            toolCallId: String(msg.toolCallId ?? ''),
            rows,
            detailFile: typeof msg.detailFile === 'string' ? msg.detailFile : null,
            schemaCompliance: typeof msg.schemaCompliance === 'boolean' ? msg.schemaCompliance : null,
            success: typeof msg.success === 'boolean' ? msg.success : null,
            diff,
            checkpoint,
          });
          break;
        }
        case 'usage':
          dispatch({
            type: 'usage',
            cumulativeUsd: Number(msg.cumulativeUsd ?? 0),
            lastCallTokens: (msg.lastCallTokens as LastCallTokens | null) ?? null,
            durationSeconds: Number(msg.durationSeconds ?? 0),
          });
          break;
        case 'context_stats':
          dispatch({
            type: 'context_stats',
            currentTokens: Number(msg.currentTokens ?? 0),
            limitTokens: Number(msg.limitTokens ?? 0),
            percent: Number(msg.percent ?? 0),
            canCompact: Boolean(msg.canCompact ?? false),
          });
          break;
        case 'context_compacting':
          dispatch({ type: 'context_compacting', active: Boolean(msg.active ?? false) });
          break;
        case 'context_compacted':
          dispatch({
            type: 'context_compacted',
            summaryExcerpt: String(msg.summaryExcerpt ?? ''),
            summary: String(msg.summary ?? msg.summaryExcerpt ?? ''),
            tokensBefore: Number(msg.tokensBefore ?? 0),
            tokensAfter: Number(msg.tokensAfter ?? 0),
          });
          break;
        case 'checkpoint_state': {
          const rawEntries = Array.isArray(msg.entries) ? (msg.entries as Record<string, unknown>[]) : [];
          dispatch({
            type: 'checkpoint_state',
            root: String(msg.root ?? ''),
            currentIndex: typeof msg.currentIndex === 'number' ? msg.currentIndex : -1,
            entries: rawEntries.map((e) => ({ sha: String(e.sha ?? ''), undone: e.undone === true })),
          });
          break;
        }
        case 'ui_settings':
          dispatch({
            type: 'ui_settings',
            showTimestamps: Boolean(msg.showTimestamps),
            timezone: typeof msg.timezone === 'string' && msg.timezone ? msg.timezone : 'system',
            clockFormat: coerceClockFormatPreset(msg.clockFormat),
          });
          break;
        case 'file_change':
          dispatch({
            type: 'file_change',
            path: String(msg.path ?? ''),
            kind: String(msg.kind ?? 'modify'),
          });
          break;
        case 'approval_request':
          dispatch({
            type: 'approval_request',
            gateId: String(msg.gateId ?? ''),
            gateType: String(msg.gateType ?? ''),
            summary: String(msg.summary ?? ''),
            artifactPath: msg.artifactPath ? String(msg.artifactPath) : null,
          });
          break;
        case 'question_request': {
          const rawQuestions = Array.isArray(msg.questions) ? msg.questions : [];
          const questions: AskUserQuestion[] = rawQuestions.map((q) => {
            const rec = q as Record<string, unknown>;
            return {
              question: String(rec.question ?? ''),
              kind: rec.kind === 'multi_choice' ? 'multi_choice' : 'single_choice',
              options: Array.isArray(rec.options) ? rec.options.map((o) => String(o)) : [],
            };
          });
          dispatch({
            type: 'question_request',
            requestId: String(msg.requestId ?? ''),
            toolCallId: String(msg.toolCallId ?? ''),
            questions,
          });
          break;
        }
        case 'permission_request': {
          const rawParams = Array.isArray(msg.params) ? msg.params : [];
          const params: PermissionParamRow[] = rawParams.map((p) => {
            const rec = p as Record<string, unknown>;
            return { name: String(rec.name ?? ''), value: String(rec.value ?? '') };
          });
          const rawParts = Array.isArray(msg.parts) ? msg.parts : [];
          const parts: PermissionPart[] = rawParts.map((p) => {
            const rec = p as Record<string, unknown>;
            const rawOffer = rec.ruleOffer as Record<string, unknown> | null | undefined;
            return {
              reason: String(rec.reason ?? ''),
              ruleOffer: rawOffer
                ? { executable: String(rawOffer.executable ?? ''), subcommand: String(rawOffer.subcommand ?? '') }
                : null,
            };
          });
          dispatch({
            type: 'permission_request',
            requestId: String(msg.requestId ?? ''),
            toolCallId: String(msg.toolCallId ?? ''),
            toolName: String(msg.toolName ?? ''),
            externalName: String(msg.externalName ?? ''),
            risk: String(msg.risk ?? ''),
            intent: String(msg.intent ?? ''),
            reason: String(msg.reason ?? ''),
            params,
            recovered: msg.recovered === true,
            parts,
          });
          break;
        }
        case 'stuck_alert_request': {
          const rawReasons = Array.isArray(msg.reasons) ? msg.reasons : [];
          dispatch({
            type: 'stuck_alert_request',
            requestId: String(msg.requestId ?? ''),
            agentName: String(msg.agentName ?? ''),
            displayName: String(msg.displayName ?? ''),
            reasons: rawReasons.map((r) => String(r)),
          });
          break;
        }
        case 'agent_unstuck_nudge': {
          const rawReasons = Array.isArray(msg.reasons) ? msg.reasons : [];
          dispatch({
            type: 'agent_unstuck_nudge',
            note: String(msg.note ?? ''),
            reasons: rawReasons.map((r) => String(r)),
            mode: String(msg.mode ?? ''),
          });
          break;
        }
        case 'agent_stuck_critical':
          dispatch({ type: 'agent_stuck_critical', message: String(msg.message ?? '') });
          break;
        case 'cyclic_thinking_notice':
          dispatch({ type: 'cyclic_thinking_notice', message: String(msg.message ?? '') });
          break;
        case 'agent_cyclic_thinking_critical':
          dispatch({
            type: 'agent_cyclic_thinking_critical',
            message: String(msg.message ?? ''),
          });
          break;
        case 'file_review_request':
          dispatch({
            type: 'file_review_request',
            requestId: String(msg.requestId ?? ''),
            toolCallId: String(msg.toolCallId ?? ''),
            toolName: String(msg.toolName ?? ''),
            path: String(msg.path ?? ''),
            mode: msg.mode === 'modification' ? 'modification' : 'new_file',
            oldContent: String(msg.oldContent ?? ''),
            newContent: String(msg.newContent ?? ''),
          });
          break;
        case 'file_review_selection':
          dispatch({
            type: 'file_review_selection',
            hasSelection: Boolean(msg.hasSelection),
            lineFrom: Number(msg.lineFrom ?? 0),
            lineTo: Number(msg.lineTo ?? 0),
            targetedCode: String(msg.targetedCode ?? ''),
          });
          break;
        case 'add_feedback_draft':
          // Convergent second entry point (the editor/context "Add Feedback"
          // command) for the exact same action the in-panel button uses —
          // both open the composer modal off the live selection already
          // pushed via file_review_selection.
          dispatch({ type: 'file_review_open_composer' });
          break;
        case 'mode_state':
          dispatch({
            type: 'mode_state',
            autonomous: Boolean(msg.autonomous),
            effectiveAutonomous: Boolean(msg.effectiveAutonomous),
            workflowMode: msg.workflowMode === 'guided' ? 'guided' : 'problem_solving',
            effectiveWorkflowMode: msg.effectiveWorkflowMode === 'guided' ? 'guided' : 'problem_solving',
            editControl: coerceEditControl(msg.editControl),
            commandControl: coerceCommandControl(msg.commandControl),
            editCommandLocked: Boolean(msg.editCommandLocked),
            thinkingLevel: String(msg.thinkingLevel ?? ''),
            thinkingFamily:
              msg.thinkingFamily === 'qwen_reasoning_budget' || msg.thinkingFamily === 'gpt_oss_reasoning_effort'
                ? msg.thinkingFamily
                : null,
            thinkingTiers: Array.isArray(msg.thinkingTiers) ? msg.thinkingTiers.map((t) => String(t)) : [],
            running: Boolean(msg.running),
            workspaceConnected: msg.workspaceConnected !== false,
          });
          break;
        case 'persist_session_id':
          // Stash the id so VS Code's panel serializer can resume this exact
          // session after a window reload / workspace reopen.
          vscode.setState({ sessionId: String(msg.sessionId ?? '') });
          break;
        case 'resume_offer':
          dispatch({ type: 'resume_offer', sessionId: String(msg.sessionId ?? '') });
          break;
        case 'restore_prompt':
          dispatch({ type: 'restore_prompt', text: String(msg.text ?? '') });
          break;
      }
    }
    window.addEventListener('message', onMessage);
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  function sendPrompt() {
    const el = inputRef.current;
    if (!el) return;
    const text = el.value.trim();
    if (!text || !state.connected) return;
    vscode.postMessage({ type: 'prompt', text });
    el.value = '';
    el.style.height = '';
    dispatch({ type: 'prompt_sent', text });
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendPrompt();
    }
  }

  // A turn is in progress iff the server reports phase "running" (forwarded as
  // `state.running` via the `mode_state` message). The older `state.stage`
  // signal is dead — the server's `state` event no longer carries a `stage`
  // field, so it is always 'IDLE' and must not gate the Stop button.
  const isRunning = state.running;
  const isBlocked =
    state.pendingGate !== null ||
    state.pendingQuestion !== null ||
    state.pendingPermission !== null ||
    state.pendingStuckAlert !== null ||
    state.pendingFileReview !== null;
  const inputDisabled = !state.connected || isRunning || isBlocked;

  function handleStop() {
    vscode.postMessage({ type: 'stop' });
  }

  function handleCompact() {
    vscode.postMessage({ type: 'compact_now' });
  }

  function handleDelete() {
    // Confirmation + deletion are driven by the extension host (native dialog).
    vscode.postMessage({ type: 'delete_session' });
  }

  function handleReconnectWorkspace() {
    // Confirmation + the actual window reload are driven by the extension
    // host (native dialog + `SessionDeps.reconnectWorkspace`).
    vscode.postMessage({ type: 'reconnect_workspace' });
  }

  function handleAttach() {
    // The open dialog, validation, and file reading all live in the host; it
    // posts back `attachment_added` for each accepted file.
    vscode.postMessage({ type: 'attach_file' });
  }

  function removeAttachment(id: string) {
    // Drop the chip locally and tell the host to forget the file's content.
    dispatch({ type: 'attachment_removed', id });
    vscode.postMessage({ type: 'remove_attachment', id });
  }

  function handleInput(e: Event) {
    const el = e.currentTarget as HTMLTextAreaElement;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }

  function handleResume() {
    vscode.postMessage({ type: 'resume', sessionId: state.resumeSessionId ?? '' });
    dispatch({ type: 'resume_dismissed' });
  }

  const isEmpty = state.session.length === 0 && !state.streamingTokens && !state.streamingThinking && !state.awaitingLlm && !state.llmWaiting && !state.namingSession && !state.toolgenActive && !state.compacting;

  return (
    <div style={styles.root}>
      {/* Resume banner */}
      {state.resumeSessionId !== null && (
        <ResumeBanner onResume={handleResume} onDismiss={() => dispatch({ type: 'resume_dismissed' })} />
      )}

      {state.lastPong !== null && (
        <div style={styles.pongLine}>Pong at {state.lastPong}</div>
      )}

      {/* Usage panel */}
      <UsagePanel
        sessionName={state.sessionName}
        currentProject={state.currentProject}
        cumulativeUsd={state.cumulativeUsd}
        lastCallTokens={state.lastCallTokens}
        contextStats={state.contextStats}
        compacting={state.compacting}
        onCompact={handleCompact}
      />

      {/* Session feed */}
      <div style={styles.stream}>
        {state.session.map((entry, i) =>
          entry.type === 'ask_user' ? (
            // Keyed by toolCallId so local selections and the mount-only
            // auto-scroll survive history reconciliation reordering indexes.
            <AskUserPanel
              key={entry.toolCallId}
              entry={entry}
              requestId={
                state.pendingQuestion !== null && state.pendingQuestion.toolCallId === entry.toolCallId
                  ? state.pendingQuestion.requestId
                  : null
              }
              onRespond={(requestId: string, answers: AskUserAnswer[]) => {
                vscode.postMessage({ type: 'question_respond', requestId, answers });
                dispatch({ type: 'question_answered', toolCallId: entry.toolCallId, answers });
              }}
            />
          ) : (
            <SessionEntryView key={i} entry={entry} uiSettings={state.uiSettings} />
          ),
        )}
        {state.streamingThinking && (
          <ThinkingBlock content={state.streamingThinking} isActive={state.thinkingActive} startedAt={state.thinkingStartedAt} />
        )}
        {state.streamingTokens && (
          <div style={styles.agentTokens}><Markdown content={state.streamingTokens} /></div>
        )}
        {state.toolgenActive && (
          <ToolgenBlock
            toolName={state.toolgenToolName}
            content={state.streamingToolgen}
            startedAt={state.toolgenStartedAt}
          />
        )}
        {state.namingSession && <NamingIndicator />}
        {state.compacting && <CompactingIndicator />}
        {state.llmWaiting && <LlmWaitingIndicator waiting={state.llmWaiting} />}
        {state.awaitingLlm && !state.llmWaiting && <AwaitingIndicator />}
        {isEmpty && (
          state.connected ? "Hello there. I'm Kodo. Ready to build something awesome." : 'Not connected to server.'
        )}
      </div>

      {/* File events */}
      {state.fileEvents.length > 0 && (
        <FileEventList events={state.fileEvents} />
      )}

      {/* Permission prompt / stuck-agent alarm / approval gate (replace the
          prompt input when pending). Questions render in-feed as
          AskUserPanel; while one is pending the prompt input below stays
          disabled via isBlocked. */}
      {state.pendingPermission !== null ? (
        <PermissionPanel
          permission={state.pendingPermission}
          onRespond={(action, feedback, remember) => {
            vscode.postMessage({
              type: 'permission_respond',
              requestId: state.pendingPermission!.requestId,
              action,
              feedback,
              remember,
            });
            dispatch({ type: 'permission_cleared' });
          }}
        />
      ) : state.pendingStuckAlert !== null ? (
        <StuckAlertPanel
          alert={state.pendingStuckAlert}
          onRespond={(action) => {
            vscode.postMessage({
              type: 'stuck_alert_respond',
              requestId: state.pendingStuckAlert!.requestId,
              action,
            });
            dispatch({ type: 'stuck_alert_cleared' });
          }}
        />
      ) : state.pendingFileReview !== null ? (
        <FileReviewPanel
          review={state.pendingFileReview}
          selection={state.fileReviewSelection}
          drafts={state.fileReviewDrafts}
          composer={state.fileReviewComposer}
          onOpenComposer={() => dispatch({ type: 'file_review_open_composer' })}
          onEditDraft={(index) => dispatch({ type: 'file_review_edit_draft', index })}
          onCloseComposer={() => dispatch({ type: 'file_review_close_composer' })}
          onApplyComposer={(text) => dispatch({ type: 'file_review_apply_draft', text })}
          onRemoveDraft={(index) => dispatch({ type: 'file_review_remove_draft', index })}
          onRespond={(action, feedback) => {
            vscode.postMessage({
              type: 'file_review_respond',
              requestId: state.pendingFileReview!.requestId,
              action,
              feedback,
            });
            dispatch({ type: 'file_review_cleared' });
          }}
        />
      ) : state.pendingGate !== null ? (
        <ApprovalGate
          gate={state.pendingGate}
          onRespond={(action, feedback) => {
            vscode.postMessage({
              type: 'approval_respond',
              gateId: state.pendingGate!.gateId,
              action,
              feedback,
            });
            dispatch({ type: 'approval_cleared' });
          }}
        />
      ) : (
        <div style={styles.inputArea}>
          <textarea
            ref={inputRef}
            style={inputDisabled ? styles.input : { ...styles.input, ...styles.inputActive }}
            placeholder={
              state.pendingQuestion !== null
                ? 'Answer the questions above, then Confirm and Send…'
                : 'Type a prompt and press Enter…'
            }
            disabled={inputDisabled}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
          />
          {/* Per-session mode toggles (apply to the next prompt) */}
          <ModeControls
            autonomous={state.autonomous}
            effectiveAutonomous={state.effectiveAutonomous}
            workflowMode={state.workflowMode}
            effectiveWorkflowMode={state.effectiveWorkflowMode}
            editControl={state.editControl}
            commandControl={state.commandControl}
            editCommandLocked={state.editCommandLocked}
            thinkingLevel={state.thinkingLevel}
            thinkingFamily={state.thinkingFamily}
            thinkingTiers={state.thinkingTiers}
            connected={state.connected}
            running={state.running}
          />
          <div style={styles.inputFooter}>
            <AttachedFilesArea files={state.attachedFiles} onRemove={removeAttachment} />
            <div style={styles.footerButtons}>
              {!state.workspaceConnected && (
                <FooterButton
                  style={styles.reconnectBtn}
                  onClick={handleReconnectWorkspace}
                  disabled={!state.connected}
                  title="Open workspace associated with this session."
                >
                  {'📂'}
                </FooterButton>
              )}
              <FooterButton
                style={styles.sendBtn}
                onClick={sendPrompt}
                disabled={inputDisabled}
                title="Send prompt (Enter)"
              >
                {isRunning ? '…' : '↑'}
              </FooterButton>
              <FooterButton
                style={styles.attachBtn}
                onClick={handleAttach}
                disabled={!state.connected || state.attachedFiles.length >= 9}
                title="Attach text files to the next prompt"
              >
                +
              </FooterButton>
              <FooterButton
                style={styles.globalStopBtn}
                onClick={handleStop}
                disabled={!state.connected || !isRunning}
                title="Stop all running agent work"
              >
                {'🛑'}
              </FooterButton>
              <FooterButton
                style={styles.deleteBtn}
                onClick={handleDelete}
                disabled={!state.connected}
                title="Delete this session (permanently removes all its history)"
              >
                {'🗑'}
              </FooterButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
