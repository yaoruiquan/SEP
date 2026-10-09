import type { ClientTaskMirrorEvent } from './use-client-task-mirrors';

export interface ClientTaskContent {
  id: string;
  type: 'user_input' | 'model_output';
  clientRunId?: string;
  participationId?: string | null;
  sequence: number;
  text: string;
  received: number;
  total: number;
  incomplete: boolean;
  /** Earliest valid client occurrence, never replaced with a receipt timestamp. */
  occurredAt: string | null;
  /** Earliest valid server receipt (event.createdAt). */
  receivedAt: string | null;
  timeApproximate: boolean;
}

function validTime(value: string | null): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

/** Never combine content from different runs or node executions. */
export function assembleClientTaskContent(events: ClientTaskMirrorEvent[]): ClientTaskContent[] {
  const groups = new Map<string, {
    content: ClientTaskContent;
    chunks: Map<number, string>;
    inconsistent: boolean;
    occurredTimes: number[];
    receivedTimes: number[];
    missingTime: boolean;
  }>();
  const result: ClientTaskContent[] = [];
  for (const event of [...events].sort((a, b) => a.sequence - b.sequence)) {
    if (event.type !== 'user_input' && event.type !== 'model_output') continue;
    const match = /^content:v1:([^:]+):(\d+):(\d+)$/.exec(event.stepKey ?? '');
    const index = match ? Number(match[2]) : NaN;
    const total = match ? Number(match[3]) : NaN;
    if (!match || !Number.isSafeInteger(index) || !Number.isSafeInteger(total) || index < 0 || total < 1 || index >= total) {
      result.push({
        id: event.id, type: event.type, clientRunId: event.clientRunId, participationId: event.participationId,
        sequence: event.sequence, text: event.message ?? '', received: 1, total: 1,
        incomplete: Boolean(event.stepKey?.startsWith('content:v1:')),
        occurredAt: validTime(event.occurredAt) === null ? null : event.occurredAt,
        receivedAt: validTime(event.createdAt) === null ? null : event.createdAt,
        timeApproximate: validTime(event.occurredAt) === null || Boolean(event.stepKey?.startsWith('content:v1:')),
      });
      continue;
    }
    const key = JSON.stringify([event.clientRunId ?? null, event.participationId ?? null, event.type, match[1]]);
    let group = groups.get(key);
    if (!group) {
      group = {
        content: {
          id: key, type: event.type, clientRunId: event.clientRunId, participationId: event.participationId,
          sequence: event.sequence, text: '', received: 0, total, incomplete: false,
          occurredAt: null, receivedAt: null, timeApproximate: false,
        },
        chunks: new Map(), inconsistent: false, occurredTimes: [], receivedTimes: [], missingTime: false,
      };
      groups.set(key, group);
      result.push(group.content);
    }
    if (total !== group.content.total || (group.chunks.has(index) && group.chunks.get(index) !== event.message)) {
      group.inconsistent = true;
    }
    if (!group.chunks.has(index)) group.chunks.set(index, event.message ?? '');
    const occurred = validTime(event.occurredAt);
    const received = validTime(event.createdAt);
    if (occurred === null) group.missingTime = true;
    else group.occurredTimes.push(occurred);
    if (received !== null) group.receivedTimes.push(received);
  }
  for (const { content, chunks, inconsistent, occurredTimes, receivedTimes, missingTime } of groups.values()) {
    content.received = chunks.size;
    content.incomplete = inconsistent || chunks.size !== content.total;
    const earliest = occurredTimes.length ? occurredTimes.reduce((a, b) => Math.min(a, b)) : null;
    content.occurredAt = earliest === null ? null : new Date(earliest).toISOString();
    content.receivedAt = receivedTimes.length ? new Date(receivedTimes.reduce((a, b) => Math.min(a, b))).toISOString() : null;
    content.timeApproximate = missingTime || content.incomplete || (earliest !== null && occurredTimes.reduce((a, b) => Math.max(a, b)) - earliest > 60000);
    let previous = -1;
    content.text = [...chunks.entries()].sort(([a], [b]) => a - b).map(([index, text]) => {
      const gap = index > previous + 1 ? '\n[缺失片段]\n' : '';
      previous = index;
      return gap + text;
    }).join('');
    if (previous < content.total - 1) content.text += '\n[缺失片段]';
  }
  return result;
}
