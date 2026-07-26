/**
 * The passive per-session UI cache that rehydrates the webview on a fresh
 * mount: stage/agent, the streamed-token buffer, usage, context stats,
 * compaction, file-change events, session history/name, and a pending
 * resume offer. Fed entirely by server envelopes; never itself decides to
 * send anything.
 */

import type * as vscode from 'vscode';
import type { FileEventData, LastCallTokens, UsageSummary } from './types';

const TOKEN_BUFFER_MAX = 64 * 1024;

type Post = (msg: Record<string, unknown>) => void;

interface ContextStats {
  currentTokens: number;
  limitTokens: number;
  percent: number;
  canCompact: boolean;
}

interface SessionHistory {
  entries: Record<string, unknown>[];
  subsessions: Record<string, Record<string, unknown>[]>;
}

export class ActivityCache {
  private stage = 'IDLE';
  private agent: string | null = null;
  private tokens = '';
  private usage: UsageSummary = { cumulativeUsd: 0, lastCallTokens: null };
  private contextStats: ContextStats | null = null;
  private compacting = false;
  private fileEvents: FileEventData[] = [];
  private sessionHistory: SessionHistory | null = null;
  private sessionName = '';
  private resumeSessionId: string | null = null;

  constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly post: Post,
  ) {}

  setStage(stage: string, agent: string | null): void {
    this.stage = stage;
    this.agent = agent;
    this.post({ type: 'stage', stage: this.stage, agent: this.agent });
  }

  setAgentStarted(agent: string): void {
    this.agent = agent;
    this.post({ type: 'agent_started', agent });
  }

  appendToken(text: string): void {
    this.tokens += text;
    if (this.tokens.length > TOKEN_BUFFER_MAX) {
      this.tokens = this.tokens.slice(-TOKEN_BUFFER_MAX / 2);
    }
    this.post({ type: 'token', text });
  }

  /** Reset on a fresh prompt submit. */
  resetForSubmit(): void {
    this.tokens = '';
    this.fileEvents = [];
  }

  setSessionHistory(entries: Record<string, unknown>[], rawSubsessions: unknown): void {
    const subsessions: Record<string, Record<string, unknown>[]> = {};
    if (rawSubsessions && typeof rawSubsessions === 'object') {
      for (const [sid, subEntries] of Object.entries(rawSubsessions as Record<string, unknown>)) {
        if (Array.isArray(subEntries)) {
          subsessions[sid] = subEntries as Record<string, unknown>[];
        }
      }
    }
    this.sessionHistory = { entries, subsessions };
    this.post({ type: 'session_history', entries: this.sessionHistory.entries, subsessions: this.sessionHistory.subsessions });
  }

  setSessionName(name: string): void {
    this.sessionName = name;
    this.panel.title = name || 'Kōdo';
    this.post({ type: 'session_name', name });
  }

  addFileEvent(fe: FileEventData): void {
    this.fileEvents.push(fe);
    this.post({ type: 'file_change', ...fe });
  }

  setUsage(cumulativeUsd: number, lastCallTokens: LastCallTokens | null, durationSeconds: number): void {
    this.usage = { cumulativeUsd, lastCallTokens };
    this.post({ type: 'usage', cumulativeUsd, lastCallTokens, durationSeconds });
  }

  setContextStats(stats: ContextStats): void {
    this.contextStats = stats;
    this.post({ type: 'context_stats', ...stats });
  }

  setCompacting(active: boolean): void {
    this.compacting = active;
    this.post({ type: 'context_compacting', active });
  }

  setResumeOffer(sessionId: string): void {
    this.resumeSessionId = sessionId;
    this.post({ type: 'resume_offer', sessionId });
  }

/** Replay just `stage` — first thing `_rehydrate` posts. Split from
   *  {@link rehydrateHistoryAndName} because `mode_state`/`ui_settings` are
   *  interleaved between the two in the controller's exact original posting
   *  order. */
  rehydrateStage(): void {
    this.post({ type: 'stage', stage: this.stage, agent: this.agent });
  }

  /** Replay `session_history`/`session_name` — posted AFTER `mode_state`/
   *  `ui_settings` in the original `_rehydrate`, not alongside `stage`. */
  rehydrateHistoryAndName(): void {
    if (this.sessionHistory !== null) {
      this.post({ type: 'session_history', entries: this.sessionHistory.entries, subsessions: this.sessionHistory.subsessions });
    }
    if (this.sessionName) {
      this.post({ type: 'session_name', name: this.sessionName });
    }
  }

  /** The tail half of rehydrate — split out only because `restore_prompt`
   *  and the mode toggles' `llm_turn_start` are interleaved between this and
   *  {@link rehydrateHistoryAndName} in the controller's exact original
   *  posting order. */
  rehydrateTail(): void {
    if (this.tokens) {
      this.post({ type: 'token', text: this.tokens });
    }
    if (this.usage.lastCallTokens !== null || this.usage.cumulativeUsd > 0) {
      this.post({ type: 'usage', ...this.usage });
    }
    if (this.contextStats !== null) {
      this.post({ type: 'context_stats', ...this.contextStats });
    }
    if (this.compacting) {
      this.post({ type: 'context_compacting', active: true });
    }
    for (const fe of this.fileEvents) {
      this.post({ type: 'file_change', ...fe });
    }
  }

  rehydrateResumeOffer(): void {
    if (this.resumeSessionId !== null) {
      this.post({ type: 'resume_offer', sessionId: this.resumeSessionId });
    }
  }
}
