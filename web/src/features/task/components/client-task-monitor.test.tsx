import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientTaskMonitor } from './client-task-monitor';
const { task } = vi.hoisted(() => ({ task: { id: 'mirror-1', title: '联调任务', taskType: 'conversation', status: 'PAUSED', progress: 0, lastHeartbeatAt: '2020-01-01T00:00:00Z' } }));
vi.mock('../use-client-task-mirrors', () => ({
  useClientTaskMirrors: () => ({ data: [task] }),
  useClientTaskMirror: () => ({ data: { events: [] } }),
}));
afterEach(cleanup);
describe('client monitor status', () => {
  it('does not replace a paused task state with an offline inference', () => {
    render(<ClientTaskMonitor />);
    expect(screen.getByText('已暂停')).toBeInTheDocument();
    expect(screen.getByText('心跳延迟')).toBeInTheDocument();
  });
  it('does not mark completed tasks offline because their heartbeat stopped', () => {
    task.status = 'COMPLETED';
    render(<ClientTaskMonitor />);
    expect(screen.getByText('已完成')).toBeInTheDocument();
    expect(screen.queryByText('心跳延迟')).not.toBeInTheDocument();
    task.status = 'PAUSED';
  });
});
