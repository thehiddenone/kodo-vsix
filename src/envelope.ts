/** Wire-protocol envelope mirroring the Python Envelope dataclass. */

export type MessageKind =
  | 'request'
  | 'response'
  | 'event'
  | 'stream_chunk'
  | 'thinking_chunk'
  | 'stream_end';

export interface Envelope {
  kind: MessageKind;
  id: string;
  payload: Record<string, unknown>;
  correlation_id?: string;
}

function newId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function makeRequest(
  msgType: string,
  payload: Record<string, unknown> = {},
): Envelope {
  return {
    kind: 'request',
    id: newId(),
    payload: { type: msgType, ...payload },
  };
}

export function makeResponse(
  correlationId: string,
  payload: Record<string, unknown>,
): Envelope {
  return {
    kind: 'response',
    id: newId(),
    correlation_id: correlationId,
    payload,
  };
}

export function toJson(env: Envelope): string {
  return JSON.stringify(env);
}

export function fromJson(raw: string): Envelope {
  return JSON.parse(raw) as Envelope;
}
