import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SettingsCenter from './SettingsCenter';
import BasicSettings from './BasicSettings';

const mocks = vi.hoisted(() => ({ update: vi.fn(), success: vi.fn(), includePolicyRows: true, includeRewards: false }));
vi.mock('./ModelRuntimePolicySettings', () => ({ default: () => <div>专用策略编辑器</div> }));
vi.mock('@/features/model/use-models', () => ({ useUpstreamModels: () => ({ data: [], isFetching: false }) }));
vi.mock('@/components/ui/toast', () => ({ toast: { success: mocks.success, error: vi.fn() } }));
vi.mock('@/features/admin/use-admin', () => {
  const data = [
    { key: 'MODEL_RESPONSE_TIMEOUT', category: 'ai', label: '旧响应超时', value: '30', secret: false, editable: true, configured: true, type: 'number' },
    { key: 'MAX_CONCURRENT_SESSIONS', category: 'users', label: '旧并发会话', value: '0', secret: false, editable: true, configured: true },
    { key: 'MAX_TOKENS_PER_CONVERSATION', category: 'users', label: '旧对话额度', value: '0', secret: false, editable: true, configured: true },
    { key: 'GATEWAY_MEMBER_RPM', category: 'ai', label: '成员频率', value: '120', secret: false, editable: true, configured: true },
    { key: 'MODEL_RUNTIME_POLICY_REVISION', category: 'ai', label: '策略内部版本', value: '1', secret: false, editable: true, configured: true },
    { key: 'SUB2API_DEFAULT_MODEL', category: 'ai', label: '默认模型', value: 'test-model', secret: false, editable: true, configured: true },
    { key: 'DEPLOY_READ_ONLY', category: 'runtime', label: '部署字段', value: 'safe', secret: false, editable: false, configured: true },
  ];
  const genericOnlyData = data.filter((setting) => setting.key !== 'GATEWAY_MEMBER_RPM' && setting.key !== 'MODEL_RUNTIME_POLICY_REVISION');
  const rewards = { key: 'CONTRIBUTION_REWARDS_ENABLED', category: 'billing', label: '贡献奖励开关', value: 'false', secret: false, editable: true, configured: true, type: 'boolean' };
  const dataWithRewards = [...data, rewards];
  const genericWithRewards = [...genericOnlyData, rewards];
  return {
    useSettings: () => ({ data: mocks.includePolicyRows
      ? (mocks.includeRewards ? dataWithRewards : data)
      : (mocks.includeRewards ? genericWithRewards : genericOnlyData), isLoading: false }),
    useUpdateSettings: () => ({ mutateAsync: mocks.update, isPending: false }),
  };
});

beforeEach(() => { vi.resetAllMocks(); mocks.includePolicyRows = true; mocks.includeRewards = false; mocks.update.mockResolvedValue([]); });
afterEach(cleanup);

describe('设置中心策略入口兼容', () => {
  it('贡献奖励默认显示关闭，保存关闭状态不改奖励金额', async () => {
    mocks.includeRewards = true;
    render(<BasicSettings />);
    const rewards = screen.getByRole('switch', { name: '启用贡献奖励' });
    expect(rewards).not.toBeChecked();
    expect(screen.getByText('关闭后不产生新奖励，已有余额和历史流水不变。')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '保存所有设置' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith({ SUB2API_DEFAULT_MODEL: 'test-model', CONTRIBUTION_REWARDS_ENABLED: 'false' }));
  });

  it.each([false, true])('专用策略导航隐藏计数，不依赖通用响应是否包含专用键（%s）', (includePolicyRows) => {
    mocks.includePolicyRows = includePolicyRows;
    render(<SettingsCenter />);
    expect(screen.getByRole('button', { name: /^模型运行策略$/ })).toHaveTextContent(/^模型运行策略$/);
    expect(screen.getByRole('button', { name: /AI 服务/ })).toHaveTextContent(/^AI 服务2$/);
  });

  it('新增专用分类，通用分类不编辑旧键或写入专用键/版本', async () => {
    render(<SettingsCenter />);
    fireEvent.click(screen.getByRole('button', { name: /模型运行策略/ }));
    expect(screen.getByText('专用策略编辑器')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /AI 服务/ }));
    expect(screen.getByRole('spinbutton')).toBeDisabled();
    expect(screen.getByText(/未接入执行，旧值仅供审查/)).toBeInTheDocument();
    expect(screen.queryByText('策略内部版本')).not.toBeInTheDocument();
    expect(screen.queryByText('成员频率')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '保存本分类' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith({ SUB2API_DEFAULT_MODEL: 'test-model' }));
  });

  it('旧 BasicSettings 保存排除停用字段、专用字段和只读部署字段', async () => {
    render(<BasicSettings />);
    expect(screen.getByText(/历史值：30。未接入执行/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '保存所有设置' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith({ SUB2API_DEFAULT_MODEL: 'test-model' }));
  });
});
