import { describe, expect, it } from 'vitest';
import { assembleClientTaskContent, clientTaskReplyEmptyState, clientTaskStateEvidence, parseClientTaskMetadata } from './client-task-content';
import type { ClientTaskMirrorEvent } from './use-client-task-mirrors';

function event(sequence: number, message: string, stepKey: string | null = null, clientRunId = 'run-a', type = 'model_output'): ClientTaskMirrorEvent {
  return { id: `${clientRunId}-${type}-${sequence}`, clientRunId, sequence, type, message, stepKey, progress: null, occurredAt: null, createdAt: '' };
}

describe('client task content', () => {
  it('joins long text without truncation or inserted separators and sorts chunks', () => {
    const text = '长文本\n'.repeat(800);
    const parts = Array.from({ length: Math.ceil(text.length / 1000) }, (_, i) => event(i + 1, text.slice(i * 1000, (i + 1) * 1000), `content:v1:msg:${i}:4`));
    const [content] = assembleClientTaskContent(parts.reverse());
    expect(content.text).toBe(text);
    expect(content.incomplete).toBe(false);
  });
  it('keeps runs and input/output separate even when message IDs collide', () => {
    const content = assembleClientTaskContent([
      event(1, 'A', 'content:v1:same:0:1'),
      event(2, 'B', 'content:v1:same:0:1', 'run-b'),
      event(3, 'C', 'content:v1:same:0:1', 'run-a', 'user_input'),
    ]);
    expect(content.map((item) => item.text)).toEqual(['A', 'B', 'C']);
  });
  it('marks missing middle, beginning and trailing chunks rather than silently concatenating', () => {
    const [content] = assembleClientTaskContent([event(1, 'first', 'content:v1:msg:1:5'), event(2, 'third', 'content:v1:msg:3:5')]);
    expect(content.incomplete).toBe(true);
    expect(content.received).toBe(2);
    expect(content.text).toBe('\n[缺失片段]\nfirst\n[缺失片段]\nthird\n[缺失片段]');
  });
  it('ignores identical duplicate chunks, flags inconsistent totals or duplicate text', () => {
    const [content] = assembleClientTaskContent([event(1, 'A', 'content:v1:msg:0:2'), event(2, 'A', 'content:v1:msg:0:2'), event(3, 'B', 'content:v1:msg:1:2')]);
    expect(content.text).toBe('AB');
    expect(content.incomplete).toBe(false);
    expect(assembleClientTaskContent([event(1, 'A', 'content:v1:m:0:1'), event(2, 'B', 'content:v1:m:0:1')])[0].incomplete).toBe(true);
  });
  it('preserves old unchunked text and does not treat lifecycle events as output', () => {
    expect(assembleClientTaskContent([event(1, 'old\ntext'), event(2, 'running', null, 'run-a', 'status')]).map((item) => item.text)).toEqual(['old\ntext']);
  });
  it('shows malformed chunk metadata without allocating unbounded arrays', () => {
    const [content] = assembleClientTaskContent([event(1, 'text', 'content:v1:m:0:999999999999999999999')]);
    expect(content.text).toBe('text');
    expect(content.incomplete).toBe(true);
  });
  it('isolates nodes and repeated executions when message IDs collide', () => {
    const content = assembleClientTaskContent([
      { ...event(1, 'node one', 'content:v1:m:0:1'), participationId: 'p-1' },
      { ...event(2, 'node two', 'content:v1:m:0:1'), participationId: 'p-2' },
      { ...event(3, 'node one retry', 'content:v1:m:0:1'), participationId: 'p-3' },
      event(4, 'root', 'content:v1:m:0:1'),
    ]);
    expect(content.map((item) => item.text)).toEqual(['node one', 'node two', 'node one retry', 'root']);
    expect(content.map((item) => item.participationId)).toEqual(['p-1', 'p-2', 'p-3', undefined]);
  });
  it('uses the earliest chunk occurrence separately from delayed server receipt', () => {
    const [content] = assembleClientTaskContent([
      { ...event(1, 'B', 'content:v1:m:1:2'), occurredAt: '2026-10-09T01:00:20Z', createdAt: '2026-10-09T02:00:20Z' },
      { ...event(2, 'A', 'content:v1:m:0:2'), occurredAt: '2026-10-09T01:00:00Z', createdAt: '2026-10-09T02:00:00Z' },
    ]);
    expect(content.text).toBe('AB');
    expect(content.occurredAt).toBe('2026-10-09T01:00:00.000Z');
    expect(content.receivedAt).toBe('2026-10-09T02:00:00.000Z');
    expect(content.timeApproximate).toBe(false);
  });
  it('marks missing, invalid, inconsistent or incomplete chunk times approximate', () => {
    const valid = { ...event(1, 'A', 'content:v1:m:0:2'), occurredAt: '2026-10-09T01:00:00Z', createdAt: '2026-10-09T02:00:00Z' };
    for (const occurredAt of [null, 'invalid', '2026-10-09T01:01:01Z']) {
      const [content] = assembleClientTaskContent([valid, { ...event(2, 'B', 'content:v1:m:1:2'), occurredAt }]);
      expect(content.timeApproximate).toBe(true);
      expect(content.occurredAt).toBe('2026-10-09T01:00:00.000Z');
    }
    expect(assembleClientTaskContent([valid])[0].timeApproximate).toBe(true);
  });
  it('never substitutes receipt time for absent occurrence and handles legacy timestamps', () => {
    const [missing] = assembleClientTaskContent([{ ...event(1, 'legacy'), createdAt: '2026-10-09T02:00:00Z' }]);
    expect(missing.occurredAt).toBeNull();
    expect(missing.receivedAt).toBe('2026-10-09T02:00:00Z');
    expect(missing.timeApproximate).toBe(true);
    const [valid] = assembleClientTaskContent([{ ...event(1, 'legacy'), occurredAt: '2026-10-09T01:00:00Z', createdAt: 'invalid' }]);
    expect(valid.occurredAt).toBe('2026-10-09T01:00:00Z');
    expect(valid.receivedAt).toBeNull();
    expect(valid.timeApproximate).toBe(false);
  });
});

const manifest = (sequence: number, overrides: Record<string, unknown> = {}, clientRunId = 'run-a') =>
  event(sequence, JSON.stringify({ version: 1, messageId: 'msg', type: 'model_output', chunks: 1,
    source: 'canonical', completeness: 'complete', ...overrides }), null, clientRunId, 'content_manifest');
const state = (sequence: number, status = 'RUNNING', clientRunId = 'run-a') =>
  event(sequence, JSON.stringify({ version: 1, reportedStatus: status, source: 'live', observedAt: '2026-10-10T01:00:00Z' }), null, clientRunId, 'monitor_state');

describe('client task evidence', () => {
  it('requires a matching manifest and all actual pieces for complete content', () => {
    const body = event(1, 'answer', 'content:v1:msg:0:1');
    expect(assembleClientTaskContent([body])[0].completeness).toBe('unverified');
    expect(assembleClientTaskContent([body, manifest(2)])[0].completeness).toBe('complete');
    expect(assembleClientTaskContent([body, manifest(2, { chunks: 2 })])[0].completeness).toBe('partial');
    expect(assembleClientTaskContent([{ ...body, stepKey: 'content:v1:msg:0:2' }, manifest(2, { chunks: 2 })])[0].completeness).toBe('partial');
    expect(assembleClientTaskContent([body, manifest(2, { completeness: 'unverified' })])[0].completeness).toBe('unverified');
  });
  it('upgrades unverified content using the newest valid uniquely bound complete manifest', () => {
    const body = event(1, 'answer', 'content:v1:msg:0:1');
    const unverified = manifest(2, { completeness: 'unverified' });
    expect(assembleClientTaskContent([body, unverified])[0].completeness).toBe('unverified');
    expect(assembleClientTaskContent([manifest(3), unverified, body, manifest(4, { extra: true })])[0].completeness).toBe('complete');
  });
  it('upgrades a valid partial manifest to complete without keeping the old partial verdict', () => {
    const body = event(1, 'answer', 'content:v1:msg:0:1');
    const partial = manifest(2, { completeness: 'partial' });
    expect(assembleClientTaskContent([body, partial])[0].completeness).toBe('partial');
    expect(assembleClientTaskContent([body, partial, manifest(3)])[0].completeness).toBe('complete');
  });
  it('keeps missing or inconsistent actual chunks partial despite a newer complete manifest', () => {
    const first = event(1, 'A', 'content:v1:msg:0:2');
    const partial = manifest(2, { chunks: 2, completeness: 'partial' });
    expect(assembleClientTaskContent([first, partial, manifest(4, { chunks: 2 })])[0].completeness).toBe('partial');
    const second = event(3, 'B', 'content:v1:msg:1:2');
    expect(assembleClientTaskContent([first, partial, second, manifest(4, { chunks: 2 })])[0].completeness).toBe('complete');
    expect(assembleClientTaskContent([first, second, event(4, 'conflict', 'content:v1:msg:1:2'), manifest(5, { chunks: 2 })])[0].completeness).toBe('partial');
  });
  it('uses only the newest proof for replacement and never borrows an older replacement declaration', () => {
    const old = event(1, 'old answer');
    const body = event(2, 'answer', 'content:v1:msg:0:1');
    const previous = manifest(3, { replacesSequences: [1] });
    expect(assembleClientTaskContent([old, body, previous, manifest(4)])).toHaveLength(2);
    for (const completeness of ['partial', 'unverified']) {
      const contents = assembleClientTaskContent([old, body, previous, manifest(4, { completeness, replacesSequences: [1] })]);
      expect(contents).toHaveLength(2);
      expect(contents[1].completeness).toBe(completeness);
    }
    expect(assembleClientTaskContent([old, body, manifest(3, { completeness: 'partial' }), manifest(4, { replacesSequences: [1] })]).map((item) => item.text)).toEqual(['answer']);
    expect(assembleClientTaskContent([old, { ...old, id: 'duplicate' }, body, manifest(4, { replacesSequences: [1] })])).toHaveLength(3);
  });
  it('requires the manifest to follow every referenced body sequence before proving or replacing content', () => {
    const old = event(1, 'old answer');
    const body = event(3, 'answer', 'content:v1:msg:0:1');
    for (const sequence of [2, 3]) {
      const contents = assembleClientTaskContent([old, body, manifest(sequence, { replacesSequences: [1] })]);
      expect(contents).toHaveLength(2);
      expect(contents[1].completeness).toBe('unverified');
    }
    expect(assembleClientTaskContent([old, body, manifest(4, { replacesSequences: [1] })]).map((item) => item.text)).toEqual(['answer']);
  });
  it('never borrows manifests from another run, participation or input type', () => {
    const body = { ...event(1, 'answer', 'content:v1:msg:0:1'), participationId: 'p1' };
    for (const proof of [manifest(2), { ...manifest(2), participationId: 'p2' },
      { ...manifest(2, {}, 'run-b'), participationId: 'p1' }, { ...manifest(2, { type: 'user_input' }), participationId: 'p1' }]) {
      expect(assembleClientTaskContent([body, proof])[0].completeness).toBe('unverified');
    }
  });
  it('binds legacy content only through exact unique sequence references', () => {
    const body = event(1, 'old');
    expect(assembleClientTaskContent([body, manifest(2)])[0].completeness).toBe('unverified');
    expect(assembleClientTaskContent([body, manifest(2, { legacySequences: [1] })])[0].completeness).toBe('complete');
    const repeated = [body, { ...body, id: 'other' }, manifest(2, { legacySequences: [1] })];
    expect(assembleClientTaskContent(repeated).every((item) => item.completeness !== 'complete')).toBe(true);
  });
  it('hides an old body only with a complete uniquely bound replacement, preserving identical rounds', () => {
    const old = event(1, 'short'), replacement = event(2, 'short complete', 'content:v1:msg:0:1');
    expect(assembleClientTaskContent([old, replacement])).toHaveLength(2);
    expect(assembleClientTaskContent([old, replacement, manifest(3, { replacesSequences: [1] })]).map((item) => item.text)).toEqual(['short complete']);
    expect(assembleClientTaskContent([old, replacement, manifest(3, { completeness: 'partial', replacesSequences: [1] })])).toHaveLength(2);
    expect(assembleClientTaskContent([event(1, 'same', 'content:v1:one:0:1'), event(2, 'same', 'content:v1:two:0:1')])).toHaveLength(2);
  });
  it('rejects invalid, oversized, extra-field or runless metadata', () => {
    for (const bad of [manifest(2, { messageId: 'bad:id' }), manifest(2, { extra: true }),
      manifest(2, { legacySequences: Array.from({ length: 65 }, (_, i) => i + 1) }),
      manifest(2, { legacySequences: [0] }), manifest(2, { messageId: 'x'.repeat(101) }),
      { ...manifest(2), clientRunId: undefined }, { ...manifest(2), message: 'x'.repeat(1001) }]) {
      expect(parseClientTaskMetadata(bad)).toBeNull();
    }
  });
  it('uses only latest same-scope state evidence without reviving an older matching state', () => {
    expect(clientTaskStateEvidence([state(1), state(2, 'PAUSED')], 'RUNNING', { clientRunId: 'run-a' })).toBeNull();
    expect(clientTaskStateEvidence([state(1), state(2, 'PAUSED', 'run-b')], 'RUNNING', { clientRunId: 'run-a' })?.source).toBe('live');
    expect(clientTaskStateEvidence([{ ...state(1), participationId: 'p2' }], 'RUNNING', { clientRunId: 'run-a', participationId: 'p1' })).toBeNull();
  });
  it('does not revive old evidence when the latest payload is invalid or has an earlier observation time', () => {
    const scope = { clientRunId: 'run-a', participationId: 'p1' };
    const previous = { ...state(1), participationId: 'p1' };
    for (const latest of [
      { ...state(2), message: '{invalid' },
      { ...state(2, 'PAUSED'), message: JSON.stringify({ version: 1, reportedStatus: 'PAUSED', source: 'snapshot', observedAt: '2020-01-01T00:00:00Z' }) },
    ]) {
      expect(clientTaskStateEvidence([previous, { ...latest, participationId: 'p1' }], 'RUNNING', scope)).toBeNull();
    }
    expect(clientTaskStateEvidence([previous, state(3, 'PAUSED')], 'RUNNING', scope)?.reportedStatus).toBe('RUNNING');
  });
  it('distinguishes recovery conclusions and does not borrow them across unknown scopes', () => {
    for (const [reason, label] of [['not-generated', '尚未生成回复'], ['source-missing', '历史回复无法恢复'], ['ambiguous', '归属待核查']]) {
      const recovery = event(1, JSON.stringify({ version: 1, reason, checkedAt: '2026-10-10T01:00:00Z', source: 'local-history' }), null, 'run-a', 'content_recovery');
      expect(clientTaskReplyEmptyState([recovery])).toContain(label);
      expect(clientTaskReplyEmptyState([recovery, event(2, 'input', null, 'run-b', 'user_input')])).toBe('暂未收到回复，原因未确认');
    }
  });
});
