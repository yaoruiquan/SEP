import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@/lib/api-client';
import { useAuthStore } from '@/lib/auth-store';
import ModelRuntimePolicySettings from './ModelRuntimePolicySettings';
import { historyFixture, policyFixture } from './model-runtime-policy.fixtures';

const mocks = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn(), success: vi.fn() }));
vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/api-client')>(),
  api: { get: mocks.get, put: mocks.put, post: mocks.post },
}));
vi.mock('@/components/ui/toast', () => ({ toast: { success: mocks.success } }));

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><ModelRuntimePolicySettings /></QueryClientProvider>);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  useAuthStore.setState({ user: { id: 'admin', role: 'ADMIN', email: 'admin@test.local', name: null, avatar: null } });
  mocks.get.mockResolvedValue(policyFixture());
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('模型运行策略设置', () => {
  it('展示分组、有效值、来源、版本和部署核验，不提供嵌套卡片', async () => {
    setup();
    await screen.findByRole('heading', { name: '客户端超时' });
    expect(screen.getByRole('heading', { name: 'Web 与任务规划超时' })).toBeInTheDocument();
    expect(screen.getAllByText(/当前有效值：120 秒 · 系统默认 · 版本 1/).length).toBeGreaterThan(0);
    expect(screen.getByText(/代理超时与发布排空：需部署核验/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '预览变更' })).toBeDisabled();
  });

  it('秒精确转 ms，先预览和填写原因才保存，保存中防重复', async () => {
    let resolveWrite!: (value: unknown) => void;
    mocks.put.mockImplementation(() => new Promise((resolve) => { resolveWrite = resolve; }));
    setup();
    fireEvent.change(await screen.findByLabelText('客户端：等待响应头'), { target: { value: '91' } });
    fireEvent.click(screen.getByRole('button', { name: '预览变更' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/91 秒（数据库覆盖）/)).toBeInTheDocument();
    const confirm = within(dialog).getByRole('button', { name: '确认保存' });
    expect(confirm).toBeDisabled();
    expect(mocks.put).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText('变更原因'), { target: { value: '  容量核验  ' } });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.put).toHaveBeenCalledTimes(1));
    expect(mocks.put).toHaveBeenCalledWith('/settings/model-runtime-policy', { expectedVersion: 1, updates: { GATEWAY_STREAM_HEADER_TIMEOUT_MS: '91000' }, reason: '容量核验' });
    resolveWrite({ ...policyFixture(2, { GATEWAY_STREAM_HEADER_TIMEOUT_MS: '91000' }), changes: [], message: 'saved' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mocks.success).toHaveBeenCalledWith('已保存，新请求使用版本 2；运行中请求保持原策略', undefined);
  });

  it('预算开关关闭保留输入，提交 0，再开启恢复草稿', async () => {
    setup();
    const toggle = await screen.findByRole('switch', { name: '启用企业每分钟资源预留预算' });
    const budget = screen.getByLabelText('企业每分钟资源预留预算（保守估算）');
    expect(budget).toBeDisabled();
    fireEvent.click(toggle);
    fireEvent.change(budget, { target: { value: '500000' } });
    fireEvent.click(toggle);
    expect(budget).toHaveValue(500000);
    expect(budget).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '预览变更' }));
    expect(within(screen.getByRole('dialog')).getByText(/变更后：0 预留单位/)).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '取消' }));
    fireEvent.click(toggle);
    expect(budget).toHaveValue(500000);
    expect(budget).toBeEnabled();
  });

  it('409 保留草稿与原因，重载最新版本差异后显式再次保存', async () => {
    mocks.put.mockRejectedValueOnce(new ApiError(409, 'version conflict'));
    setup();
    const header = await screen.findByLabelText('客户端：等待响应头');
    fireEvent.change(header, { target: { value: '90' } });
    fireEvent.click(screen.getByRole('button', { name: '预览变更' }));
    fireEvent.change(screen.getByLabelText('变更原因'), { target: { value: '保留原因' } });
    fireEvent.click(screen.getByRole('button', { name: '确认保存' }));
    await screen.findByText(/策略版本冲突，草稿和原因已保留/);
    expect(header).toHaveValue(90);
    expect(screen.getByRole('button', { name: '预览变更' })).toBeDisabled();
    mocks.get.mockResolvedValue(policyFixture(2, { GATEWAY_MEMBER_RPM: '150', GATEWAY_STREAM_HEADER_TIMEOUT_MS: '80000' }));
    fireEvent.click(screen.getByRole('button', { name: '重新加载并保留草稿' }));
    await screen.findByText(/已加载最新版本 2，草稿已保留/);
    expect(header).toHaveValue(90);
    expect(screen.getByLabelText('成员业务请求次数')).toHaveValue(150);
    expect(within(screen.getByLabelText('变更预览')).getByText(/当前：80 秒/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '预览变更' }));
    expect(screen.getByLabelText('变更原因')).toHaveValue('保留原因');
    mocks.put.mockResolvedValue({ ...policyFixture(3, { GATEWAY_STREAM_HEADER_TIMEOUT_MS: '90000', GATEWAY_MEMBER_RPM: '150' }), changes: [], message: 'saved' });
    fireEvent.click(screen.getByRole('button', { name: '确认保存' }));
    await waitFor(() => expect(mocks.put).toHaveBeenLastCalledWith('/settings/model-runtime-policy', { expectedVersion: 2, updates: { GATEWAY_STREAM_HEADER_TIMEOUT_MS: '90000' }, reason: '保留原因' }));
  });

  it('恢复环境 / 默认预览取消覆盖，不承诺历史回退值', async () => {
    mocks.get.mockResolvedValue(policyFixture(1, { GATEWAY_STREAM_HEADER_TIMEOUT_MS: '90000' }));
    setup();
    fireEvent.click(await screen.findByRole('button', { name: '客户端：等待响应头：恢复环境 / 默认' }));
    fireEvent.click(screen.getByRole('button', { name: '预览变更' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('取消覆盖');
    expect(screen.getByRole('dialog')).toHaveTextContent('按当前环境 / 默认重新计算，保存后确认有效值');
  });

  it('窗口长度变更的成功提示准确说明旧窗口不立即切换', async () => {
    mocks.put.mockResolvedValue({ ...policyFixture(2, { GATEWAY_MODEL_RATE_WINDOW_MS: '30000' }), changes: [{ key: 'GATEWAY_MODEL_RATE_WINDOW_MS' }], message: 'saved' });
    setup();
    fireEvent.change(await screen.findByLabelText('客户端订阅组合计数窗口'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: '预览变更' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('当前计数窗口到期后采用新窗口。');
    fireEvent.change(screen.getByLabelText('变更原因'), { target: { value: '调整计数窗口' } });
    fireEvent.click(screen.getByRole('button', { name: '确认保存' }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith('已保存，新请求使用版本 2；运行中请求保持原策略', '当前计数窗口到期后采用新窗口。'));
    expect(mocks.put).toHaveBeenCalledWith('/settings/model-runtime-policy', { expectedVersion: 1, updates: { GATEWAY_MODEL_RATE_WINDOW_MS: '30000' }, reason: '调整计数窗口' });
  });

  it('400 整批校验失败保留草稿、原因和确认框，不显示保存成功', async () => {
    mocks.put.mockRejectedValue(new ApiError(400, '环境回退总时长小于空闲时长'));
    mocks.get.mockResolvedValue(policyFixture(1, { GATEWAY_STREAM_HEADER_TIMEOUT_MS: '90000' }));
    setup();
    fireEvent.click(await screen.findByRole('button', { name: '客户端：等待响应头：恢复环境 / 默认' }));
    fireEvent.click(screen.getByRole('button', { name: '预览变更' }));
    fireEvent.change(screen.getByLabelText('变更原因'), { target: { value: '尝试恢复环境' } });
    fireEvent.click(screen.getByRole('button', { name: '确认保存' }));
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent('环境回退总时长小于空闲时长'));
    expect(screen.getByLabelText('变更原因')).toHaveValue('尝试恢复环境');
    expect(screen.getByLabelText('客户端：等待响应头')).toHaveValue(null);
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.put).toHaveBeenCalledWith('/settings/model-runtime-policy', { expectedVersion: 1, updates: { GATEWAY_STREAM_HEADER_TIMEOUT_MS: '' }, reason: '尝试恢复环境' });
  });

  it.each(['before', 'after'] as const)('历史 cursor 分页并确认恢复 %s，产生新版本', async (side) => {
    const item = historyFixture();
    mocks.get.mockImplementation(async (path: string) => path.includes('/history')
      ? { items: [item], nextCursor: path.includes('cursor=') ? null : 'cursor-2' }
      : policyFixture(3, { GATEWAY_STREAM_HEADER_TIMEOUT_MS: '60000' }));
    mocks.post.mockResolvedValue({ ...policyFixture(4), changes: [], message: 'saved' });
    setup();
    fireEvent.click(await screen.findByRole('button', { name: '变更历史' }));
    await screen.findByText('原因：容量核验');
    fireEvent.click(screen.getByRole('button', { name: '历史下一页' }));
    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith('/settings/model-runtime-policy/history?limit=20&cursor=cursor-2'));
    expect(screen.getByText('第 2 页')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: '历史下一页' })).toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: side === 'before' ? '恢复变更前' : '恢复变更后' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('历史有效值不保证复现');
    expect(mocks.post).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('变更原因'), { target: { value: '恢复确认' } });
    fireEvent.click(screen.getByRole('button', { name: '确认恢复并创建新版本' }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/settings/model-runtime-policy/restore', { expectedVersion: 3, historyId: 'history-1', side, reason: '恢复确认' }));
  });

  it('writeEnabled=false 只读，保留原因和预检告警', async () => {
    mocks.get.mockResolvedValue({ ...policyFixture(), writeEnabled: false, warnings: ['环境指纹不一致'] });
    setup();
    await screen.findByText('环境指纹不一致');
    expect(screen.getByLabelText('客户端：等待响应头')).toBeDisabled();
    expect(screen.queryByRole('button', { name: '预览变更' })).not.toBeInTheDocument();
  });

  it('非平台管理员不请求策略，也不显示写入口', () => {
    useAuthStore.setState({ user: { id: 'member', role: 'USER', email: 'member@test.local', name: null, avatar: null }, roleInEnterprise: 'ENTERPRISE_ADMIN' });
    setup();
    expect(screen.getByText('仅平台管理员可查看模型运行策略。')).toBeInTheDocument();
    expect(mocks.get).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '预览变更' })).not.toBeInTheDocument();
  });

  it('加载失败可重试，历史空状态明确', async () => {
    mocks.get.mockRejectedValueOnce(new ApiError(503, '数据库不可用'));
    setup();
    await screen.findByText(/模型运行策略加载失败：数据库不可用/);
    mocks.get.mockImplementation(async (path: string) => path.includes('/history') ? { items: [], nextCursor: null } : policyFixture());
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    fireEvent.click(await screen.findByRole('button', { name: '变更历史' }));
    await screen.findByText('暂无策略变更记录。');
  });

  it('历史响应缺少 items 时显示异常状态而不崩溃或提供恢复入口', async () => {
    mocks.get.mockImplementation(async (path: string) => path.includes('/history') ? {} : policyFixture());
    setup();
    fireEvent.click(await screen.findByRole('button', { name: '变更历史' }));
    await screen.findByText('历史响应格式异常，请重新加载。');
    expect(screen.queryByRole('button', { name: '恢复变更前' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('客户端：等待响应头')).toBeInTheDocument();
  });
});
