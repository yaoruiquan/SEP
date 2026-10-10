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
const skillRow = () => within(screen.getByRole('link', { name: /测试技能\s*(?:已启用：企业版|已启用：平台版|暂无启用版本|副本正在使用)/ }));
beforeEach(() => { vi.clearAllMocks(); mockData(data()); });

describe('CapabilityIterationList 副本使用状态', () => {
  it.each(['ENTERPRISE', 'PLATFORM', null] as const)('基线 %s 标明默认版本，分组和平铺不显示使用说明', (scope) => {
    const value = data();
    value.items[0].currentVersion = scope ? { id: 'baseline', version: '1.0.0', scope } : null;
    mockData(value);
    render(<CapabilityIterationList />);
    const label = scope === 'ENTERPRISE' ? '已启用：企业版 1.0.0'
      : scope === 'PLATFORM' ? '已启用：平台版 1.0.0' : '暂无启用版本';
    expect(skillRow().getByText(label)).toBeVisible();
    expect(screen.queryByText('个人版本按员工订阅分别设置，在详情查看')).not.toBeInTheDocument();
    expect(screen.queryByText('跟随平台版')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '平铺' }));
    expect(skillRow().getByText(label)).toBeVisible();
    expect(screen.queryByText('个人版本按员工订阅分别设置，在详情查看')).not.toBeInTheDocument();
  });

  it('没有副本时不伪造已保存或正在使用标签', () => {
    const value = data();
    value.items[0].myPersonalVersionId = null;
    value.items[0].pendingAdoptionCount = 0;
    mockData(value);
    render(<CapabilityIterationList />);
    expect(skillRow().getByText('已启用：企业版 1.0.0')).toBeInTheDocument();
    expect(screen.queryByText(/副本已保存|副本正在使用/)).not.toBeInTheDocument();
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
    expect(skillRow().getByText('已启用：企业版 1.0.0')).toBeInTheDocument();
    if (canManage) expect(screen.getByRole('link', { name: /未绑定送审技能\s*暂无启用版本/ })).toBeVisible();
    fireEvent.click(group);
    expect(screen.queryByRole('link', { name: /企业历史技能/ })).not.toBeInTheDocument();
    expect(skillRow().getByText('已启用：企业版 1.0.0')).toBeVisible();
    fireEvent.click(group);
    fireEvent.change(screen.getByPlaceholderText('搜索技能或硅基员工'), { target: { value: '企业历史技能' } });
    expect(screen.getByRole('link', { name: /企业历史技能/ })).toBeVisible();
    expect(screen.queryByRole('link', { name: /测试技能\s*默认/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '平铺' }));
    expect(within(screen.getByRole('link', { name: /企业历史技能/ })).getByText('企业技能')).toBeVisible();
  });
  it.each([true, false])('历史个人PIN状态%s不能抢占企业启用版本或显示正在使用', (active) => {
    useIterableCapabilities.mockReturnValue({ data: data(active) });
    render(<CapabilityIterationList />);
    expect(skillRow().getByText('已启用：企业版 1.0.0')).toBeVisible();
    expect(screen.getByText('个人提交 · 等待企业审核')).toBeVisible();
    expect(screen.queryByText(/副本正在使用|副本已保存|创建自己的副本/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '平铺' }));
    expect(screen.getByText('企业启用版本')).toBeVisible();
    expect(skillRow().getByText('已启用：企业版 1.0.0')).toBeVisible();
  });

});
