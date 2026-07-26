/**
 * The four simple "the server is blocked on a yes/no-ish answer from the
 * user" request/response pairs: the legacy approval gate, `prompt.permission`
 * (security layer), `prompt.stuck_alert` (the stuck-agent watchdog), and
 * `prompt.question` (`ask_user`). Each is independent — at most one of each
 * kind is outstanding at a time, cached so a webview reload can replay it via
 * {@link PromptGateManager.rehydrate}.
 *
 * Deliberately excludes `prompt.edit_review` — that one drives a companion
 * editor tab too, which is its own concern (`ReviewGateController`).
 */

import type { Envelope } from '../envelope';
import { makeResponse } from '../envelope';
import type { AskUserQuestion, GateData, PermissionData, PermissionPart, QuestionData, StuckAlertData } from './types';

type Post = (msg: Record<string, unknown>) => void;
type Send = (env: Envelope) => void;

export class PromptGateManager {
  private gate: GateData | null = null;
  private question: QuestionData | null = null;
  private permission: PermissionData | null = null;
  private stuckAlert: StuckAlertData | null = null;

  constructor(private readonly post: Post) {}

  /** Null every pending request without responding — used when a fresh
   *  prompt is submitted, mirroring the original `_submitPrompt`'s reset. */
  clearAll(): void {
    this.gate = null;
    this.question = null;
    this.permission = null;
    this.stuckAlert = null;
  }

  handleApproval(env: Envelope): void {
    this.gate = {
      gateId: env.id,
      gateType: String(env.payload.gate_type ?? ''),
      summary: String(env.payload.summary ?? ''),
      artifactPath: env.payload.artifact_path ? String(env.payload.artifact_path) : null,
    };
    this.post({ type: 'approval_request', ...this.gate });
  }

  respondApproval(msg: Record<string, unknown>, send: Send): void {
    send(
      makeResponse(String(msg.gateId ?? ''), {
        type: 'prompt.approval.response',
        action: String(msg.action ?? 'agree'),
        feedback_text: String(msg.feedback ?? '') || null,
      }),
    );
    this.gate = null;
  }

  handlePermission(env: Envelope): void {
    const rawParams = Array.isArray(env.payload.params) ? env.payload.params : [];
    const rawParts = Array.isArray(env.payload.parts) ? env.payload.parts : [];
    const parts: PermissionPart[] = rawParts.map((p) => {
      const rec = p as Record<string, unknown>;
      const rawOffer = rec.rule_offer as Record<string, unknown> | null | undefined;
      return {
        reason: String(rec.reason ?? ''),
        ruleOffer: rawOffer
          ? { executable: String(rawOffer.executable ?? ''), subcommand: String(rawOffer.subcommand ?? '') }
          : null,
      };
    });
    this.permission = {
      requestId: env.id,
      toolCallId: String(env.payload.tool_call_id ?? ''),
      toolName: String(env.payload.tool_name ?? ''),
      externalName: String(env.payload.external_name ?? ''),
      risk: String(env.payload.risk ?? ''),
      intent: String(env.payload.intent ?? ''),
      reason: String(env.payload.reason ?? ''),
      params: rawParams.map((p) => {
        const rec = p as Record<string, unknown>;
        return { name: String(rec.name ?? ''), value: String(rec.value ?? '') };
      }),
      recovered: env.payload.recovered === true,
      parts,
    };
    this.post({ type: 'permission_request', ...this.permission });
  }

  respondPermission(msg: Record<string, unknown>, send: Send): void {
    // One entry per part the server offered (parallel to `parts` on the
    // original prompt.permission request) — 'session' | 'global' | null.
    const rawRemember = Array.isArray(msg.remember) ? msg.remember : [];
    const remember = rawRemember.map((r) => (r === 'session' || r === 'global' ? r : null));
    send(
      makeResponse(String(msg.requestId ?? ''), {
        type: 'prompt.permission.response',
        action: String(msg.action ?? 'deny'),
        feedback: String(msg.feedback ?? '') || null,
        remember,
      }),
    );
    this.permission = null;
  }

  handleStuckAlert(env: Envelope): void {
    this.stuckAlert = {
      requestId: env.id,
      agentName: String(env.payload.agent_name ?? ''),
      displayName: String(env.payload.display_name ?? ''),
      reasons: Array.isArray(env.payload.reasons) ? env.payload.reasons.map((r) => String(r)) : [],
    };
    this.post({ type: 'stuck_alert_request', ...this.stuckAlert });
  }

  respondStuckAlert(msg: Record<string, unknown>, send: Send): void {
    send(
      makeResponse(String(msg.requestId ?? ''), {
        type: 'prompt.stuck_alert.response',
        action: String(msg.action ?? 'dismiss'),
      }),
    );
    this.stuckAlert = null;
  }

  handleQuestion(env: Envelope): void {
    const rawQuestions = Array.isArray(env.payload.questions) ? env.payload.questions : [];
    const questions: AskUserQuestion[] = rawQuestions.map((q) => {
      const rec = q as Record<string, unknown>;
      return {
        question: String(rec.question ?? ''),
        kind: rec.kind === 'multi_choice' ? 'multi_choice' : 'single_choice',
        options: Array.isArray(rec.options) ? rec.options.map((o) => String(o)) : [],
      };
    });
    this.question = {
      requestId: env.id,
      toolCallId: String(env.payload.tool_call_id ?? ''),
      questions,
    };
    this.post({ type: 'question_request', ...this.question });
  }

  respondQuestion(msg: Record<string, unknown>, send: Send): void {
    // One entry per question, in order: {selected: string[], free_text: string|null}.
    const rawAnswers = Array.isArray(msg.answers) ? msg.answers : [];
    const answers = rawAnswers.map((a) => {
      const rec = a as Record<string, unknown>;
      const selected = Array.isArray(rec.selected) ? rec.selected.map((s) => String(s)) : [];
      const freeText = typeof rec.free_text === 'string' && rec.free_text.trim() ? rec.free_text : null;
      return { selected, free_text: freeText };
    });
    send(
      makeResponse(String(msg.requestId ?? ''), {
        type: 'prompt.question.response',
        answers,
      }),
    );
    this.question = null;
  }

  /** Replay every outstanding request on a fresh webview mount. */
  rehydrate(): void {
    if (this.gate !== null) {
      this.post({ type: 'approval_request', ...this.gate });
    }
    if (this.question !== null) {
      this.post({ type: 'question_request', ...this.question });
    }
    if (this.permission !== null) {
      this.post({ type: 'permission_request', ...this.permission });
    }
    if (this.stuckAlert !== null) {
      this.post({ type: 'stuck_alert_request', ...this.stuckAlert });
    }
  }
}
