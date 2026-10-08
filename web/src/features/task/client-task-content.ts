import type { ClientTaskMirrorEvent } from './use-client-task-mirrors';

export interface ClientTaskContent {
  id: string;
  type: 'user_input' | 'model_output';
  clientRunId?: string;
  sequence: number;
  text: string;
  received: number;
  total: number;
  incomplete: boolean;
}

/** Keep runs separate, even when message IDs collide; never hide missing chunks. */
export function assembleClientTaskContent(events: ClientTaskMirrorEvent[]): ClientTaskContent[] {
  const groups = new Map<string, {
    content: ClientTaskContent;
    chunks: Map<number, string>;
    inconsistent: boolean;
  }>();
  const result: ClientTaskContent[] = [];
  for (const event of [...events].sort((a, b) => a.sequence - b.sequence)) {
    if (event.type !== 'user_input' && event.type !== 'model_output') continue;
    const match = /^content:v1:([^:]+):(\d+):(\d+)$/.exec(event.stepKey ?? '');
    const index = match ? Number(match[2]) : NaN;
    const total = match ? Number(match[3]) : NaN;
    if (!match || !Number.isSafeInteger(index) || !Number.isSafeInteger(total) || index < 0 || total < 1 || index >= total) {
      result.push({
        id: event.id, type: event.type, clientRunId: event.clientRunId,
        sequence: event.sequence, text: event.message ?? '', received: 1, total: 1,
        incomplete: Boolean(event.stepKey?.startsWith('content:v1:')),
      });
      continue;
    }
    const key = JSON.stringify([event.clientRunId ?? null, event.type, match[1]]);
    let group = groups.get(key);
    if (!group) {
      group = {
        content: {
          id: key, type: event.type, clientRunId: event.clientRunId,
          sequence: event.sequence, text: '', received: 0, total, incomplete: false,
        },
        chunks: new Map(), inconsistent: false,
      };
      groups.set(key, group);
      result.push(group.content);
    }
    if (total !== group.content.total || (group.chunks.has(index) && group.chunks.get(index) !== event.message)) {
      group.inconsistent = true;
    }
    if (!group.chunks.has(index)) group.chunks.set(index, event.message ?? '');
  }
  for (const { content, chunks, inconsistent } of groups.values()) {
    content.received = chunks.size;
    content.incomplete = inconsistent || chunks.size !== content.total;
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
