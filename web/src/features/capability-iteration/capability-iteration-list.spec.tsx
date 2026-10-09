import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CapabilityIterationList } from './capability-iteration-list';
import type { IterableCapabilityList } from './use-capability-iteration';

const { useIterableCapabilities } = vi.hoisted(() => ({ useIterableCapabilities: vi.fn() }));
vi.mock('./use-capability-iteration', () => ({ useIterableCapabilities }));
vi.mock('./capability-stats', () => ({ CapabilityStats: () => <div>技能统计</div> }));

function data(active = false, canManage = false): IterableCapabilityList {
  return {
    canManage,
    summary: { capabilityCount: 1, customizedCount: 1, pendingAdoptionTotal: 1, totalRounds: 3 },
    items: [{
      capability: { id: 'cap', name: '测试技能', description: '' },
      employees: [{ employeeId: 'employee', employeeName: '员工', employeeAvatar: null,
        employeePosition: '', employeeIndustry: '', employeeCategory: '', subscriptionId: 'sub' }],
      currentVersion: { id: 'enterprise', version: '1.0.0', scope: 'ENTERPRISE' },
      usage: { totalRounds: 3, distinctUserCount: 1 }, pendingAdoptionCount: 1,
      myPersonalVersionId: 'mine', myPersonalVersionActive: active,
    }],
  };
}
function mockData(value: IterableCapabilityList) {
  useIterableCapabilities.mockReturnValue({ data: value, isLoading: false, isError: false });
}
const skillRow = () => within(screen.getByRole('link', { name: /测试技能\s*(?:默认：企业版|默认：平台版|副本正在使用)/ }));
beforeEach(() => { vi.clearAllMocks(); mockData(data()); });

describe('CapabilityIterationList 副本使用状态', () => {
  it.each(['ENTERPRISE', 'PLATFORM', null] as const)('基线 %s 标明默认版本，分组和平铺常驻提示按订阅设置个人版本', (scope) => {
    const value = data();
    value.items[0].currentVersion = scope ? { id: 'baseline', version: '1.0.0', scope } : null;
    mockData(value);
    render(<CapabilityIterationList />);
    const label = scope === 'ENTERPRISE' ? '默认：企业版 1.0.0'
      : scope === 'PLATFORM' ? '默认：平台版 1.0.0' : '默认：平台版';
    expect(skillRow().getByText(label)).toBeVisible();
    expect(screen.getByText('个人版本按员工订阅分别设置，在详情查看')).toBeVisible();
    expect(screen.queryByText('跟随平台版')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '平铺' }));
    expect(skillRow().getByText(label)).toBeVisible();
    expect(screen.getByText('个人版本按员工订阅分别设置，在详情查看')).toBeVisible();
  });

  it('副本存在但未使用时显示已保存，并保留企业基线版本', () => {
    render(<CapabilityIterationList />);
    expect(skillRow().getByText('副本已保存')).toBeInTheDocument();
    expect(skillRow().getByText('默认：企业版 1.0.0')).toBeInTheDocument();
    expect(screen.getByText('我的副本已保存 · 等待企业采纳')).toBeInTheDocument();
    expect(screen.queryByText(/正在使用|已生效/)).not.toBeInTheDocument();
  });

  it('myPersonalVersionActive 为 true 时明确正在使用，待办不再固定说已生效', () => {
    mockData(data(true));
    render(<CapabilityIterationList />);
    expect(skillRow().getByText('副本正在使用')).toBeInTheDocument();
    expect(screen.getByText('我的副本正在使用 · 等待企业采纳')).toBeInTheDocument();
    expect(screen.queryByText('副本已保存')).not.toBeInTheDocument();
    expect(screen.queryByText(/已生效/)).not.toBeInTheDocument();
  });

  it('切版查询刷新后，分组与平铺均从正在使用切回已保存', () => {
    mockData(data(true));
    const { rerender } = render(<CapabilityIterationList />);
    mockData(data(false));
    rerender(<CapabilityIterationList />);
    expect(skillRow().getByText('副本已保存')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '平铺' }));
    expect(screen.getByText('版本与副本')).toBeInTheDocument();
    expect(skillRow().getByText('副本已保存')).toBeInTheDocument();
    expect(screen.queryByText(/正在使用/)).not.toBeInTheDocument();
  });

  it('没有副本时不伪造已保存或正在使用标签', () => {
    const value = data();
    value.items[0].myPersonalVersionId = null;
    value.items[0].pendingAdoptionCount = 0;
    mockData(value);
    render(<CapabilityIterationList />);
    expect(skillRow().getByText('默认：企业版 1.0.0')).toBeInTheDocument();
    expect(screen.queryByText(/副本已保存|副本正在使用/)).not.toBeInTheDocument();
  });

  it('管理员待办仍显示成员改动数，自身副本状态单独呈现', () => {
    mockData(data(false, true));
    render(<CapabilityIterationList />);
    expect(screen.getByText('1 位成员调整过 · 去采纳')).toBeInTheDocument();
    expect(skillRow().getByText('副本已保存')).toBeInTheDocument();
    expect(screen.queryByText('我的副本已保存 · 等待企业采纳')).not.toBeInTheDocument();
  });
});
