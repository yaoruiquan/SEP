import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientTaskMonitor } from './client-task-monitor';
import type { ClientTaskMirror, ClientTaskMirrorEvent, ClientTaskMirrorPage } from '../use-client-task-mirrors';

const mocks = vi.hoisted(() => ({ list: vi.fn(), detail: vi.fn(), refetch: vi.fn() }));
vi.mock('../use-client-task-mirrors', () => ({ useClientTaskMirrors: mocks.list, useClientTaskMirror: mocks.detail }));

const task = {
  id: 'mirror-1', clientRunId: 'run-1', title: '联调任务', taskType: 'conversation',
  status: 'PAUSED', progress: 0, lastHeartbeatAt: '2020-01-01T00:00:00Z',
  user: { id: 'u-1', name: '用户甲' }, updatedAt: '2026-10-08T02:00:00Z',
} as ClientTaskMirror;
const page = (items = [task], total = items.length, page = 1): ClientTaskMirrorPage => ({ items, total, page, limit: 50, hasNextPage: page * 50 < total });
const event = (sequence: number, type: string, message: string, stepKey: string | null = null): ClientTaskMirrorEvent => ({ id: String(sequence), clientRunId: 'run-1', sequence, type, message, stepKey, progress: null, occurredAt: null, createdAt: '' });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockReturnValue({ data: page(), refetch: mocks.refetch });
  mocks.detail.mockReturnValue({ data: { events: [] } });
});
afterEach(cleanup);

describe('client monitor', () => {
  it('does not replace a paused task state with an offline inference', () => {
    render(<ClientTaskMonitor />);
    expect(screen.getByText('已暂停')).toBeInTheDocument();
    expect(screen.getByText('心跳延迟')).toBeInTheDocument();
  });
  it('does not mark completed tasks offline because their heartbeat stopped', () => {
    mocks.list.mockReturnValue({ data: page([{ ...task, status: 'COMPLETED' }]) });
    render(<ClientTaskMonitor />);
    expect(screen.getByText('已完成')).toBeInTheDocument();
    expect(screen.queryByText('心跳延迟')).not.toBeInTheDocument();
  });
  it('shows all server-authorized users without local filtering and explains cloud-only counts', () => {
    mocks.list.mockReturnValue({ data: page([task, { ...task, id: 'mirror-2', title: '另一个成员的任务', user: { id: 'u-2', name: '用户乙' } }]) });
    render(<ClientTaskMonitor />);
    expect(screen.getByText('另一个成员的任务')).toBeInTheDocument();
    expect(screen.getByText(/用户甲/)).toBeInTheDocument();
    expect(screen.getByText(/用户乙/)).toBeInTheDocument();
    expect(screen.getByText(/仅显示已同步到云端的记录 · 共 2 条/)).toBeInTheDocument();
  });
  it('displays complete multiline input/output, creator and update time on expansion', () => {
    mocks.detail.mockReturnValue({ data: { events: [event(1, 'user_input', '输入\n第二行'), event(2, 'model_output', '答复'.repeat(600), 'content:v1:m:0:2'), event(3, 'model_output', '末尾', 'content:v1:m:1:2')] } });
    render(<ClientTaskMonitor />);
    fireEvent.click(screen.getByRole('button', { name: /联调任务/ }));
    expect(screen.getByText('用户输入')).toBeInTheDocument();
    expect(screen.getByText('模型输出')).toBeInTheDocument();
    expect(screen.getByText('输入 第二行')).toBeInTheDocument();
    expect(screen.getByText(`${'答复'.repeat(600)}末尾`)).toBeInTheDocument();
    expect(screen.getByText('已组装 2 个片段')).toBeInTheDocument();
    expect(screen.getByText(/更新时间/)).toBeInTheDocument();
    expect(mocks.detail).toHaveBeenLastCalledWith(task.id, true);
  });
  it('warns for missing content chunks', () => {
    mocks.detail.mockReturnValue({ data: { events: [event(1, 'model_output', '部分内容', 'content:v1:m:0:2')] } });
    render(<ClientTaskMonitor />);
    fireEvent.click(screen.getByRole('button', { name: /联调任务/ }));
    expect(screen.getByText('正文不完整：已收到 1/2 个片段')).toBeInTheDocument();
  });
  it('queries separate pages and closes the previous detail', () => {
    mocks.list.mockImplementation((_enabled, { page: requested }) => ({ data: page([task], 101, requested) }));
    render(<ClientTaskMonitor />);
    fireEvent.click(screen.getByRole('button', { name: /联调任务/ }));
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    expect(mocks.list).toHaveBeenLastCalledWith(true, { page: 2, limit: 50 });
    expect(screen.getByText('第 2 页 · 每页 50 条')).toBeInTheDocument();
    expect(screen.queryByText('任务事件')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '上一页' }));
    expect(mocks.list).toHaveBeenLastCalledWith(true, { page: 1, limit: 50 });
  });
  it('allows returning from a failed page and retrying', () => {
    mocks.list.mockImplementation((_enabled, { page: requested }) => requested === 1 ? { data: page([task], 100) } : { isError: true, refetch: mocks.refetch });
    render(<ClientTaskMonitor />);
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    expect(screen.getByRole('alert')).toHaveTextContent('客户端任务监控暂时不可用');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '返回上一页' }));
    expect(screen.getByText('联调任务')).toBeInTheDocument();
  });
  it('distinguishes empty cloud records from missing local tasks', () => {
    mocks.list.mockReturnValue({ data: page([]) });
    render(<ClientTaskMonitor />);
    expect(screen.getByText('暂无已同步的客户端任务')).toBeInTheDocument();
  });
  it('shows detail errors rather than a false empty result', () => {
    mocks.detail.mockReturnValue({ isError: true });
    render(<ClientTaskMonitor />);
    fireEvent.click(screen.getByRole('button', { name: /联调任务/ }));
    expect(screen.getByText('事件读取失败，请稍后重试。')).toBeInTheDocument();
  });
  it('shows a compatibility notice for old server responses', () => {
    mocks.list.mockReturnValue({ data: { ...page(), legacy: true } });
    render(<ClientTaskMonitor />);
    expect(screen.getByText(/服务端尚未支持完整分页/)).toBeInTheDocument();
  });
});
