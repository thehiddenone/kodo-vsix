/**
 * Sidebar edits → the active session's pending LLM (kodo/doc/SESSION_LLM_BINDING.md
 * D7). Every sidebar setter (card, cloud vendor, tier models, profile, knobs)
 * calls in here after it writes; the session tab most recently brought to the
 * front snapshots the sidebar's card with `llm_selection.capture`. An unbound
 * session ignores the capture server-side — it follows the sidebar anyway.
 *
 * A leaf module (window state + the controller's own method only), so the
 * setters in settings-io.ts / local-llm-registry.ts / cloud-ai-settings.ts can
 * import it without a cycle through session-llm-sync.ts, which imports them.
 */

import type { SessionController } from '../session/controller';
import { state } from './state';

/** The session tab most recently brought to the front, if it is still open. */
export function lastActiveSession(): SessionController | undefined {
  return state.lastActiveSessionKey ? state.sessions.get(state.lastActiveSessionKey) : undefined;
}

/** Capture the sidebar's card into the last-active session, if it is bound. */
export function captureIntoActiveSession(): void {
  if (state.applyingSessionLlm) {
    return;
  }
  const session = lastActiveSession();
  if (session?.sessionLlm.bound) {
    session.captureLlmSelection();
  }
}

/**
 * For an edit the *server* writes (a profile or knob change): capture once its
 * `local_llm.registry_state` arrives, so the snapshot reads the new values —
 * the edit travels on the control connection, the capture on the session's.
 */
export function captureAfterRegistryUpdate(): void {
  if (!state.applyingSessionLlm) {
    state.captureAfterRegistry = true;
  }
}

/** Called on every `local_llm.registry_state`: run a capture that was waiting for it. */
export function flushCaptureAfterRegistry(): void {
  if (state.captureAfterRegistry) {
    state.captureAfterRegistry = false;
    captureIntoActiveSession();
  }
}
