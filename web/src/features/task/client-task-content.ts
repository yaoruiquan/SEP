import { z } from 'zod';
import { CLIENT_TASK_STATUS_LABELS, type ClientTaskMirrorEvent, type ClientTaskStateEvidence } from './use-client-task-mirrors';

export interface ClientTaskContent {
  id: string;
  type: 'user_input' | 'model_output';
  clientRunId?: string;
  participationId?: string | null;
  sequence: number;
  sequences: number[];
  messageId?: string;
  completeness: 'complete' | 'partial' | 'unverified';
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
        sequence: event.sequence, sequences: [event.sequence], completeness: 'unverified', text: event.message ?? '', received: 1, total: 1,
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
          sequence: event.sequence, sequences: [], messageId: match[1], completeness: 'unverified', text: '', received: 0, total, incomplete: false,
          occurredAt: null, receivedAt: null, timeApproximate: false,
        },
        chunks: new Map(), inconsistent: false, occurredTimes: [], receivedTimes: [], missingTime: false,
      };
      groups.set(key, group);
      result.push(group.content);
    }
    group.content.sequences.push(event.sequence);
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
  return applyContentEvidence(result, events);
}

const isoTime = z.string().datetime({ offset: true });
const sequenceRefs = z.array(z.number().int().positive().safe()).min(1).max(64).refine((items) => new Set(items).size === items.length);
const messageId = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const monitorStateSchema = z.object({
  version: z.literal(1), reportedStatus: z.enum(Object.keys(CLIENT_TASK_STATUS_LABELS) as [keyof typeof CLIENT_TASK_STATUS_LABELS, ...(keyof typeof CLIENT_TASK_STATUS_LABELS)[]]),
  source: z.enum(['live', 'local-run', 'snapshot']), observedAt: isoTime,
  runEndedAt: isoTime.optional(), progress: z.number().min(0).max(100).optional(),
}).strict();
const manifestSchema = z.object({
  version: z.literal(1), messageId, type: z.enum(['user_input', 'model_output']),
  chunks: z.number().int().positive().safe(), source: z.enum(['canonical', 'timeline', 'snapshot']),
  completeness: z.enum(['complete', 'partial', 'unverified']), legacySequences: sequenceRefs.optional(),
  replacesMessageId: messageId.optional(), replacesSequences: sequenceRefs.optional(),
}).strict();
const recoverySchema = z.object({
  version: z.literal(1), reason: z.enum(['not-generated', 'source-missing', 'ambiguous']),
  checkedAt: isoTime, source: z.literal('local-history'),
}).strict();

export function parseClientTaskMetadata(event: ClientTaskMirrorEvent) {
  if (!event.clientRunId || !event.message || event.message.length > 1000) return null;
  let value: unknown;
  try { value = JSON.parse(event.message); } catch { return null; }
  if (event.type === 'monitor_state') {
    const parsed = monitorStateSchema.safeParse(value);
    return parsed.success ? { type: 'monitor_state' as const, data: parsed.data } : null;
  }
  if (event.type === 'content_manifest') {
    const parsed = manifestSchema.safeParse(value);
    return parsed.success ? { type: 'content_manifest' as const, data: parsed.data } : null;
  }
  if (event.type === 'content_recovery') {
    const parsed = recoverySchema.safeParse(value);
    return parsed.success ? { type: 'content_recovery' as const, data: parsed.data } : null;
  }
  return null;
}

function sameScope(a: { clientRunId?: string; participationId?: string | null }, b: { clientRunId?: string; participationId?: string | null }) {
  return (a.clientRunId ?? null) === (b.clientRunId ?? null) && (a.participationId ?? null) === (b.participationId ?? null);
}
function exactSequences(content: ClientTaskContent, sequences: number[]) {
  return content.sequences.length === sequences.length && content.sequences.every((sequence) => sequences.includes(sequence));
}

function applyContentEvidence(contents: ClientTaskContent[], events: ClientTaskMirrorEvent[]) {
  const manifests = events.flatMap((event) => {
    const metadata = parseClientTaskMetadata(event);
    return metadata?.type === 'content_manifest' ? [{ event, data: metadata.data }] : [];
  });
  const proofs = new Map<ClientTaskContent, typeof manifests>();
  for (const content of contents) {
    const matching = manifests.filter(({ event, data }) => sameScope(event, content) && data.type === content.type
      && content.sequences.every((sequence) => sequence < event.sequence)
      && (data.legacySequences ? exactSequences(content, data.legacySequences) : content.messageId === data.messageId));
    // A manifest must uniquely identify one logical message, including legacy sequences.
    const unique = matching.filter(({ event, data }) => contents.filter((candidate) => sameScope(event, candidate) && candidate.type === data.type
      && (data.legacySequences ? exactSequences(candidate, data.legacySequences) : candidate.messageId === data.messageId)).length === 1);
    const latest = unique.sort((a, b) => b.event.sequence - a.event.sequence || b.event.id.localeCompare(a.event.id))[0];
    // Later valid evidence supersedes earlier verdicts and replacement declarations.
    proofs.set(content, latest ? [latest] : []);
    content.completeness = content.incomplete || (latest && (latest.data.completeness === 'partial' || latest.data.chunks !== content.total))
      ? 'partial' : latest?.data.completeness === 'complete' && latest.data.chunks === content.received
        ? 'complete' : 'unverified';
  }
  const replaced = new Set<ClientTaskContent>();
  for (const content of contents) {
    if (content.completeness !== 'complete') continue;
    for (const { data } of proofs.get(content) ?? []) {
      if (!data.replacesMessageId && !data.replacesSequences) continue;
      const targets = contents.filter((old) => old !== content && sameScope(old, content) && old.type === content.type
        && Math.max(...old.sequences) < content.sequence
        && (!data.replacesMessageId || old.messageId === data.replacesMessageId)
        && (!data.replacesSequences || exactSequences(old, data.replacesSequences)));
      if (targets.length === 1) replaced.add(targets[0]);
    }
  }
  return contents.filter((content) => !replaced.has(content)).sort((a, b) => {
    const aTime = validTime(a.occurredAt) ?? validTime(a.receivedAt);
    const bTime = validTime(b.occurredAt) ?? validTime(b.receivedAt);
    return aTime !== null && bTime !== null ? aTime - bTime || a.sequence - b.sequence : a.sequence - b.sequence;
  });
}

export function clientTaskStateEvidence(events: ClientTaskMirrorEvent[], status: string, scope: { clientRunId?: string; participationId?: string | null }): ClientTaskStateEvidence | null {
  const latest = events.filter((event) => sameScope(event, scope) && event.type === 'monitor_state')
    .sort((a, b) => b.sequence - a.sequence || b.id.localeCompare(a.id))[0];
  const metadata = latest ? parseClientTaskMetadata(latest) : null;
  return metadata?.type === 'monitor_state' && metadata.data.reportedStatus === status ? metadata.data : null;
}

export function validatedStateEvidence(value: unknown, status: string): ClientTaskStateEvidence | null {
  const parsed = monitorStateSchema.safeParse(value);
  return parsed.success && parsed.data.reportedStatus === status ? parsed.data : null;
}

export function clientTaskReplyEmptyState(events: ClientTaskMirrorEvent[]) {
  const scopes = new Set(events.map((event) => JSON.stringify([event.clientRunId ?? null, event.participationId ?? null])));
  if (scopes.size > 1) return '暂未收到回复，原因未确认';
  const recovery = events.flatMap((event) => {
    const metadata = parseClientTaskMetadata(event);
    return metadata?.type === 'content_recovery' ? [{ data: metadata.data, sequence: event.sequence }] : [];
  }).sort((a, b) => Date.parse(b.data.checkedAt) - Date.parse(a.data.checkedAt) || b.sequence - a.sequence)[0]?.data;
  return recovery?.reason === 'not-generated' ? '尚未生成回复'
    : recovery?.reason === 'source-missing' ? '历史回复无法恢复：本地源内容不存在'
      : recovery?.reason === 'ambiguous' ? '暂未收到回复：历史内容归属待核查' : '暂未收到回复，原因未确认';
}

export function clientTaskContentLabel(content: ClientTaskContent, status?: string) {
  return content.incomplete ? `回复同步未完成：已收到 ${content.received}/${content.total} 个片段`
    : content.completeness === 'partial' || (status === 'INTERRUPTED' && content.completeness !== 'complete') ? '部分回复'
      : content.completeness === 'complete' ? '已收到完整回复' : '已收到回复，完整性未核实';
}

export function clientTaskMetadataLabel(event: ClientTaskMirrorEvent) {
  const metadata = parseClientTaskMetadata(event);
  if (!metadata) return ['monitor_state', 'content_manifest', 'content_recovery'].includes(event.type) ? '同步证据无效，未采用' : null;
  if (metadata.type === 'monitor_state') return `客户端状态证据：${CLIENT_TASK_STATUS_LABELS[metadata.data.reportedStatus]}（${metadata.data.source === 'live' ? '实时上报' : metadata.data.source === 'local-run' ? '本地运行记录' : '历史快照'}）`;
  if (metadata.type === 'content_manifest') return `正文覆盖声明：${metadata.data.chunks} 片，需与实际正文核对`;
  return metadata.data.reason === 'not-generated' ? '本地核查：尚未生成回复' : metadata.data.reason === 'source-missing' ? '本地核查：源内容不存在' : '本地核查：内容归属待核查';
}
