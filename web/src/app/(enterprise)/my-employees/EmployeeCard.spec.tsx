import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmployeeCard } from './EmployeeCard';
import type { MyEmployee } from '@/lib/types';

const base: MyEmployee = {
  subscriptionId: 'sub-1',
  name: '客服小助手',
  templateVersion: '1.0.0',
  employee: { id: 't1', name: '客服', avatar: null },
  department: { id: 'd-1', name: '客服部' },
  grantSource: 'DEPARTMENT',
  expiresAt: null,
};
const renderCard = (patch: Partial<MyEmployee> = {}) =>
  render(<EmployeeCard employee={{ ...base, ...patch }} />);

describe('EmployeeCard', () => {
  it('使用同一人物的头肩变体，并保留完整人物 URL 为数据来源', () => {
    renderCard({
      employee: {
        ...base.employee,
        avatar: '/assets/employees/silicon/project-manager.webp',
      },
    });
    expect(screen.getByRole('img')).toHaveAttribute(
      'src',
      '/assets/employees/silicon/project-manager-face.webp',
    );
  });
  it('只保留对话和详情入口，链接分别使用模板与订阅 ID', () => {
    renderCard();
    expect(screen.getByRole('link', { name: '开始对话' })).toHaveAttribute(
      'href',
      '/chat?employeeId=t1',
    );
    expect(screen.getByRole('link', { name: '查看详情' })).toHaveAttribute(
      'href',
      '/my-employees/sub-1',
    );
    expect(screen.queryByText(/下载|管理授权|统计/)).toBeNull();
    expect(screen.getAllByText('部门授权')).toHaveLength(1);
  });
  it('直接授权不再被标成自助订阅', () => {
    renderCard({ grantSource: 'DIRECT' });
    expect(screen.getByText('直接授权')).toBeTruthy();
    expect(screen.queryByText('自助订阅')).toBeNull();
  });
  it('相同模板名不重复，最多展示三项能力', () => {
    renderCard({
      name: '客服',
      employee: {
        ...base.employee,
        bindings: Array.from({ length: 5 }, (_, i) => ({
          id: `b${i}`,
          priority: i,
          capability: {
            id: `c${i}`,
            name: `能力${i}`,
            type: 'SKILL' as const,
            description: '能力说明',
          },
        })),
      },
    });
    expect(screen.getAllByText('客服')).toHaveLength(1);
    expect(screen.getByText('能力2')).toBeTruthy();
    expect(screen.queryByText('能力3')).toBeNull();
    expect(screen.getByText('还有 2 项')).toBeTruthy();
  });
  it('未获取使用情况时不伪造零消费', () => {
    renderCard();
    expect(screen.queryByText('本月消费')).toBeNull();
  });
  it('展示实际月消费和从未使用状态', () => {
    renderCard({
      usage: {
        activeUserCount30d: 0,
        grantedUserCount: 1,
        grantedDepartmentCount: 1,
        grantedMemberCount: 0,
        lastUsedAt: null,
        monthCostCNY: '12.40',
        monthCallCount: 27,
        executionCount30d: 0,
        successRate30d: null,
      },
    });
    expect(screen.getByText('¥12.40')).toBeTruthy();
    expect(screen.getByText('从未使用')).toBeTruthy();
    expect(screen.getByText('近 30 天在用')).toBeTruthy();
    expect(screen.getByText('近 30 天成功率')).toBeTruthy();
    expect(screen.getByText(/27 次调用/)).toBeTruthy();
    expect(screen.getByText(/0 次执行/)).toBeTruthy();
    expect(screen.queryByText('0%')).toBeNull();
  });
  it('赠送条表示剩余，低余额变黄', () => {
    renderCard({
      giftStatus: 'ACTIVE',
      giftGrantedCNY: '100',
      giftRemainingCNY: '10',
    });
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '10');
    expect((bar.firstElementChild as HTMLElement).style.width).toBe('10%');
    expect(bar.firstElementChild?.className).toContain('bg-warning');
  });
  it('赠送用尽不再承诺自动扣企业钱包', () => {
    renderCard({
      giftStatus: 'EXHAUSTED',
      giftGrantedCNY: '100',
      giftRemainingCNY: '0',
    });
    expect(screen.getByText('赠送算力已用尽')).toBeTruthy();
    expect(screen.queryByText(/企业钱包/)).toBeNull();
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '0',
    );
  });
  it('没有赠送记录不展示进度条', () => {
    renderCard();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});
