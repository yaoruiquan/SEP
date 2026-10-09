import { describe, expect, it } from 'vitest';
import { assembleClientTaskContent } from './client-task-content';
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
