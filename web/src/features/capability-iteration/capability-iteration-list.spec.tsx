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
const skillRow = () => within(screen.getByRole('link', { name: /测试技能\s*(?:默认：企业版|默认：平台版|暂无默认版本|副本正在使用)/ }));
beforeEach(() => { vi.clearAllMocks(); mockData(data()); });

describe('CapabilityIterationList 副本使用状态', () => {
  it.each(['ENTERPRISE', 'PLATFORM', null] as const)('基线 %s 标明默认版本，分组和平铺不显示使用说明', (scope) => {
    const value = data();
    value.items[0].currentVersion = scope ? { id: 'baseline', version: '1.0.0', scope } : null;
    mockData(value);
    render(<CapabilityIterationList />);
    const label = scope === 'ENTERPRISE' ? '默认：企业版 1.0.0'
      : scope === 'PLATFORM' ? '默认：平台版 1.0.0' : '暂无默认版本';
    expect(skillRow().getByText(label)).toBeVisible();
    expect(screen.queryByText('个人版本按员工订阅分别设置，在详情查看')).not.toBeInTheDocument();
    expect(screen.queryByText('跟随平台版')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '平铺' }));
    expect(skillRow().getByText(label)).toBeVisible();
    expect(screen.queryByText('个人版本按员工订阅分别设置，在详情查看')).not.toBeInTheDocument();
  });

  it('副本存在但未使用时显示已保存，并保留企业基线版本', () => {
    render(<CapabilityIterationList />);
    expect(skillRow().getByText('副本已保存')).toBeInTheDocument();
    expect(skillRow().getByText('默认：企业版 1.0.0')).toBeInTheDocument();
    expect(screen.getByText('我的副本已保存 · 等待企业审核')).toBeInTheDocument();
    expect(screen.queryByText(/正在使用|已生效/)).not.toBeInTheDocument();
  });

  it('myPersonalVersionActive 为 true 时明确正在使用，待办不再固定说已生效', () => {
    mockData(data(true));
    render(<CapabilityIterationList />);
    expect(skillRow().getByText('副本正在使用')).toBeInTheDocument();
    expect(screen.getByText('我的副本正在使用 · 等待企业审核')).toBeInTheDocument();
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
    expect(screen.getByText('1 条改动 · 去审核')).toBeInTheDocument();
    expect(skillRow().getByText('副本已保存')).toBeInTheDocument();
    expect(screen.queryByText('我的副本已保存 · 等待企业审核')).not.toBeInTheDocument();
  });

  it.each([false, true])('无员工的企业历史技能与未绑定提交均显示在企业技能组，管理员=%s', (canManage) => {
    const value = data(false, canManage);
    value.items.push({ ...value.items[0], capability: { id: 'historical', name: '企业历史技能', description: '' },
      employees: [], pendingAdoptionCount: 0, myPersonalVersionId: null });
    if (canManage) value.items.push({ ...value.items[1], capability: { id: 'submitted', name: '未绑定送审技能', description: '' },
      currentVersion: null, pendingAdoptionCount: 1 });
    mockData(value);
    render(<CapabilityIterationList />);
    const group = screen.getByRole('button', { name: /企业技能/ });
    expect(group).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: /企业历史技能/ })).toHaveAttribute('href', '/capabilities/historical');
    expect(skillRow().getByText('默认：企业版 1.0.0')).toBeInTheDocument();
    if (canManage) expect(screen.getByRole('link', { name: /未绑定送审技能\s*暂无默认版本/ })).toBeVisible();
    fireEvent.click(group);
    expect(screen.queryByRole('link', { name: /企业历史技能/ })).not.toBeInTheDocument();
    expect(skillRow().getByText('默认：企业版 1.0.0')).toBeVisible();
    fireEvent.click(group);
    fireEvent.change(screen.getByPlaceholderText('搜索技能或硅基员工'), { target: { value: '企业历史技能' } });
    expect(screen.getByRole('link', { name: /企业历史技能/ })).toBeVisible();
    expect(screen.queryByRole('link', { name: /测试技能\s*默认/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '平铺' }));
    expect(within(screen.getByRole('link', { name: /企业历史技能/ })).getByText('企业技能')).toBeVisible();
  });
});
