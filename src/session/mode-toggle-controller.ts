/**
 * The mode/toggle state machine: Autonomous (interactive vs. autonomous,
 * frozen mid-turn), workflow mode (guided vs. problem-solving, also
 * frozen), Edit/Tool Control (never frozen, but forced + locked while
 * Autonomous is in effect), and Thinking level (server-owned). Owns exactly
 * the fields `_postModeState`'s snapshot is built from, so every place one of
 * them can change funnels through here and re-derives+re-posts consistently.
 */

import type { Envelope } from '../envelope';
import { makeRequest } from '../envelope';
import type { ThinkingContext } from '../llm-registry-types';
import type { CommandControl, EditControl } from './types';
import { AUTONOMOUS_COMMAND, AUTONOMOUS_EDIT, coerceCommandControl, coerceEditControl, coerceWorkflowMode } from './types';

type Post = (msg: Record<string, unknown>) => void;
type Send = (env: Envelope) => void;

export class ModeToggleController {
  // The two *frozen* toggles come in pairs: the user-facing *selected* value
  // (flips the instant the user clicks) and the per-turn frozen *effective*
  // value the server reports (what the in-flight prompt actually runs under).
  // The webview uses the pair to show "in effect" vs "queued for the next
  // prompt".
  private autonomous = false;
  private effectiveAutonomous = false;
  private workflowMode: 'guided' | 'problem_solving' = 'problem_solving';
  private effectiveWorkflowMode: 'guided' | 'problem_solving' = 'problem_solving';
  private workspaceConnected_ = true;
  // Edit/Tool Control are NEVER frozen. The host owns them: it keeps the
  // user's *selected* posture, and derives the *shown* value — which equals the
  // selection unless Autonomous mode is currently in effect, in which case it is
  // forced to Allow All / Permissive (the toggles also lock in the UI). `running`
  // (derived from the server's `phase`) decides whether "in effect" means the
  // frozen `effectiveAutonomous` (mid-turn) or the selected `autonomous` (idle),
  // so a switch to Autonomous only locks them once the next turn actually starts.
  private editControl: EditControl = 'smart';
  private commandControl: CommandControl = 'smart';
  // Thinking level is server-owned (unlike Edit/Tool Control): the valid tier
  // set is model-dependent, so the server validates every change and this is
  // simply the last value it reported via a `state` event/hello.ack, never a
  // client-side guess. `thinkingContext` is the sibling piece the *host*
  // supplies (which family, if any, the active local model belongs to) —
  // together they're enough for the webview to render the toggle, compute
  // the next tier to request on click, and show per-tier tooltips.
  private thinkingLevel = '';
  private running = false;
  // Server-authoritative twin of the webview's `awaitingLlm` ("Awaiting
  // response" spinner) — true iff the server is between an `llm.turn_start`
  // and that call's first chunk. Unlike `running` (which stays true for a
  // whole multi-round tool-use turn), this narrows to the one sub-state the
  // live `llm.turn_start`/token/thinking/toolgen events normally drive, so
  // rehydrate() can replay it after a reload that missed those live events
  // (see doc/WS_PROTOCOL.md §5.1).
  private awaitingLlm = false;
  // The last shown values pushed to the server, so we resend only on change
  // (`undefined` until the first sync forces an initial send).
  private sentEditControl: EditControl | undefined;
  private sentCommandControl: CommandControl | undefined;

  constructor(
    private thinkingContext: ThinkingContext,
    private readonly post: Post,
    private readonly send: Send,
  ) {}

  get workspaceConnected(): boolean {
    return this.workspaceConnected_;
  }

  /**
   * Whether Autonomous mode is currently *in effect* (not merely selected).
   * While a turn runs this is the frozen `effectiveAutonomous`; when idle it is
   * the live `autonomous` selection, so a mid-turn switch to Autonomous defers
   * its lock until the next turn starts, and a switch to Interactive unlocks
   * only once the running turn finishes.
   */
  private autonomousInEffect(): boolean {
    return this.running ? this.effectiveAutonomous : this.autonomous;
  }

  /** Edit Control value the UI shows — forced to Allow All under Autonomous. */
  private editShown(): EditControl {
    return this.autonomousInEffect() ? AUTONOMOUS_EDIT : this.editControl;
  }

  /** Tool Control value the UI shows — forced to Permissive under Autonomous. */
  private commandShown(): CommandControl {
    return this.autonomousInEffect() ? AUTONOMOUS_COMMAND : this.commandControl;
  }

  /**
   * Mirror the shown Edit/Command values to the server, resending only on a
   * change. The server stores exactly what the UI shows (the host is the single
   * source of truth for these never-frozen toggles), so this is called whenever
   * a shown value can move: a user flip, an autonomous toggle, a phase change.
   */
  private syncEditCommandToServer(): void {
    const edit = this.editShown();
    if (edit !== this.sentEditControl) {
      this.sentEditControl = edit;
      this.send(makeRequest('edit_control.set', { edit_control: edit }));
    }
    const command = this.commandShown();
    if (command !== this.sentCommandControl) {
      this.sentCommandControl = command;
      this.send(makeRequest('command_control.set', { command_control: command }));
    }
  }

  /**
   * Push the full mode-toggle snapshot to the webview. The two frozen toggles
   * carry their selected + effective pair; Edit/Command carry the single shown
   * value plus `editCommandLocked` (true while Autonomous is in effect, which
   * disables those two toggles). `running` lets the frozen toggles render "in
   * effect" vs "queued for the next prompt".
   */
  postModeState(): void {
    this.post({
      type: 'mode_state',
      autonomous: this.autonomous,
      effectiveAutonomous: this.effectiveAutonomous,
      workflowMode: this.workflowMode,
      effectiveWorkflowMode: this.effectiveWorkflowMode,
      editControl: this.editShown(),
      commandControl: this.commandShown(),
      editCommandLocked: this.autonomousInEffect(),
      running: this.running,
      thinkingLevel: this.thinkingLevel,
      thinkingFamily: this.thinkingContext.family,
      thinkingTiers: this.thinkingContext.tiers,
      workspaceConnected: this.workspaceConnected_,
    });
  }

  /** Apply the mode-toggle-relevant slice of a `state` event/hello.ack. */
  applyStateEvent(payload: Record<string, unknown>): void {
    const phase = String(payload.phase ?? '');
    // A turn is in progress iff the server reports phase "running"; this is the
    // authoritative signal the Edit/Command lock and the frozen-toggle "queued"
    // status hang off (the legacy `stage` field is vestigial/always IDLE).
    this.running = phase === 'running';
    // Server-authoritative snapshot for the "Awaiting response" spinner — see
    // the field doc comment. Cached (not posted directly) so `rehydrate()` can
    // replay it as a synthetic `llm_turn_start` on a fresh webview mount;
    // while connected, the live `llm.turn_start`/token/thinking/toolgen
    // events already drive the spinner themselves.
    this.awaitingLlm = Boolean(payload.awaiting_first_chunk ?? false);
    // Adopt the server's authoritative snapshot for the two *frozen* toggles —
    // both the selected values and the per-turn frozen effective values it just
    // froze/reported. Edit/Command are host-owned (never adopted from the
    // server, which only echoes back the shown value we last sent).
    this.autonomous = Boolean(payload.autonomous ?? false);
    this.effectiveAutonomous = Boolean(payload.effective_autonomous ?? this.autonomous);
    this.workflowMode = coerceWorkflowMode(payload.workflow_mode);
    this.effectiveWorkflowMode = coerceWorkflowMode(payload.effective_workflow_mode ?? payload.workflow_mode);
    // thinking_level is likewise server-owned — adopted verbatim, never
    // client-computed (doc/SESSIONS.md): a new-session seed, a resume
    // reconciliation, a model-switch reset, or a thinking_level.set accept
    // all land here the same way.
    this.thinkingLevel = String(payload.thinking_level ?? '');
    this.workspaceConnected_ = payload.workspace_connected !== false;
    // The turn boundary may have just locked/unlocked Edit & Command (a turn
    // starting under Autonomous forces Allow All/Permissive; a turn ending
    // unlocks to the user's selection) — resync the shown values if so.
    this.syncEditCommandToServer();
    this.postModeState();
  }

  applyAutonomousChanged(autonomous: boolean): void {
    // A Guide-driven disable clears both the selected and effective values
    // immediately (it accompanies a fresh `state` event carrying the same).
    this.autonomous = autonomous;
    if (!autonomous) {
      this.effectiveAutonomous = false;
    }
    // Clearing Autonomous unlocks Edit & Command back to the user's selection.
    this.syncEditCommandToServer();
    this.postModeState();
  }

  /** The `hello.ack` `thinking_level` hydration that applies uniformly to
   *  both a new and a resumed session, before either branch below runs. */
  setThinkingLevelFromHello(level: string): void {
    this.thinkingLevel = level;
  }

  /** A blank session starts interactive, problem-solving, with Edit & Command
   *  Control at their Smart default — selected == effective, nothing locked. */
  applyNewSessionDefaults(): void {
    this.workflowMode = 'problem_solving';
    this.effectiveWorkflowMode = 'problem_solving';
    this.autonomous = false;
    this.effectiveAutonomous = false;
    this.running = false;
    this.awaitingLlm = false;
    this.editControl = 'smart';
    this.commandControl = 'smart';
    this.send(makeRequest('workflow.set', { mode: 'problem_solving' }));
    this.syncEditCommandToServer();
    this.postModeState();
  }

  /**
   * Resumed: adopt the session's own persisted prefs from hello.ack state. A
   * resumed tab is never mid-turn (the worker is idle on connect), so the
   * lock follows the resumed `autonomous` selection. Hydrate the Edit/Command
   * selection from the persisted value only when *not* locked; while locked
   * the persisted value is the forced Allow All/Permissive, so we leave the
   * selection at its Smart default (it would otherwise show a stale forced
   * value on the next unlock). Same default-then-correct treatment as
   * `running`: if a turn is genuinely still going server-side, the fresh
   * `state` event `_handle_session_hello` sends right after this ack corrects
   * both fields from the live snapshot.
   */
  applyResumedState(state: Record<string, unknown>): void {
    this.autonomous = Boolean(state.autonomous ?? false);
    this.effectiveAutonomous = Boolean(state.effective_autonomous ?? this.autonomous);
    this.workflowMode = coerceWorkflowMode(state.workflow_mode);
    this.effectiveWorkflowMode = coerceWorkflowMode(state.effective_workflow_mode ?? state.workflow_mode);
    this.running = false;
    this.awaitingLlm = false;
    if (this.autonomous) {
      this.editControl = 'smart';
      this.commandControl = 'smart';
    } else {
      this.editControl = coerceEditControl(state.edit_control);
      this.commandControl = coerceCommandControl(state.command_control);
    }
    this.syncEditCommandToServer();
    this.postModeState();
  }

  /** `mode_set` webview message: a switch while idle locks/unlocks Edit &
   *  Command immediately; while a turn runs the shown values stay put
   *  (gated on `effectiveAutonomous`). */
  setAutonomous(autonomous: boolean): void {
    this.autonomous = autonomous;
    this.send(makeRequest('mode.set', { autonomous }));
    this.syncEditCommandToServer();
    this.postModeState();
  }

  /** `workflow_set` webview message. */
  setWorkflow(mode: 'guided' | 'problem_solving'): void {
    this.workflowMode = mode;
    this.send(makeRequest('workflow.set', { mode }));
    this.postModeState();
  }

  /** `edit_control_set` webview message — only reachable while unlocked (the
   *  webview disables the toggle under Autonomous), so the click always sets
   *  the user's selection. */
  setEditControl(value: unknown): void {
    if (!this.autonomousInEffect()) {
      this.editControl = coerceEditControl(value);
      this.syncEditCommandToServer();
      this.postModeState();
    }
  }

  /** `command_control_set` webview message. */
  setCommandControl(value: unknown): void {
    if (!this.autonomousInEffect()) {
      this.commandControl = coerceCommandControl(value);
      this.syncEditCommandToServer();
      this.postModeState();
    }
  }

  /**
   * Apply a new window-global thinking-tier context (the host calls this on
   * every session tab whenever the active local/cloud model changes) and
   * re-push the mode-toggle snapshot so the webview's Thinking control
   * updates immediately — e.g. disables itself the moment the user switches
   * to a non-thinking model, without waiting for a server round trip.
   */
  updateThinkingContext(ctx: ThinkingContext): void {
    this.thinkingContext = ctx;
    this.postModeState();
  }

  /** Replay the "Awaiting response" spinner on a fresh webview mount if the
   *  server was still between `llm.turn_start` and its first chunk. */
  rehydrateAwaitingLlm(): void {
    if (this.awaitingLlm) {
      this.post({ type: 'llm_turn_start' });
    }
  }
}
