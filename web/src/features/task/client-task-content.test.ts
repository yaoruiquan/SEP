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
});
