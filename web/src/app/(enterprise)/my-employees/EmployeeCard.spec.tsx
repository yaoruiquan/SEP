import { describe, expect, it, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmployeeCard } from './EmployeeCard';
import type { MyEmployee } from '@/lib/types';

beforeAll(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/features/capability/use-capability', () => ({
  useDownloadSkill: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const download = { mutate: vi.fn(), isPending: false } as never;

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
  render(<EmployeeCard employee={{ ...base, ...patch }} isAdmin={false} download={download} />);

describe('EmployeeCard', () => {
  it('「授权来源」只出现一次 —— 卡片头部已经写了，内容区不再重复', () => {
    renderCard();

    expect(screen.queryAllByText('授权来源')).toHaveLength(0);
    // 头部那处是不带标签的值本身
    expect(screen.getAllByText('部门授权')).toHaveLength(1);
  });

  it('雇佣关系名与模板名相同时不复读，只留版本号', () => {
    renderCard({
      name: '客服',
      employee: { id: 't1', name: '客服', avatar: null },
    });

    // 标题已经是「客服」了，副标题再写一遍看着像 bug
    expect(screen.getAllByText('客服')).toHaveLength(1);
    expect(screen.getByText('v1.0.0')).toBeTruthy();
  });

  it('雇佣关系名被改过时仍要显示来自哪个模板', () => {
    renderCard();

    expect(screen.getByText('客服小助手')).toBeTruthy();
    // 模板名单独成一行（后面紧跟版本号的 span）
    expect(screen.getByText('客服')).toBeTruthy();
    expect(screen.getByText('v1.0.0')).toBeTruthy();
  });

  it('没有使用情况时整段不渲染，而不是显示一排 0', () => {
    renderCard();

    expect(screen.queryByText('近 30 天在用')).toBeNull();
    expect(screen.queryByText(/本月消费/)).toBeNull();
  });

  it('有使用情况时给出在用人数、已授权人数、上次使用与本月消费', () => {
    renderCard({
      usage: {
        activeUserCount30d: 3,
        grantedUserCount: 8,
        grantedDepartmentCount: 1,
        grantedMemberCount: 0,
        lastUsedAt: new Date(Date.now() - 86400_000).toISOString(),
        monthCostCNY: '12.40',
        monthCallCount: 27,
        executionCount30d: 115,
        successRate30d: 96,
      },
    });

    expect(screen.getByText('近 30 天在用')).toBeTruthy();
    expect(screen.getByText('3 人')).toBeTruthy();
    expect(screen.getByText(/已授权 8 人/)).toBeTruthy();
    expect(screen.getByText(/¥12\.40 · 27 次调用/)).toBeTruthy();
    expect(screen.getByText('96%')).toBeTruthy();
  });

  it('成功率必须带分母 —— 只给比例读者判断不了可信度', () => {
    renderCard({
      usage: {
        activeUserCount30d: 1,
        grantedUserCount: 1,
        grantedDepartmentCount: 1,
        grantedMemberCount: 0,
        lastUsedAt: new Date().toISOString(),
        monthCostCNY: '0.04',
        monthCallCount: 1,
        executionCount30d: 6,
        successRate30d: 67,
      },
    });

    expect(screen.getByText(/6 次执行/)).toBeTruthy();
    // 口径写在标签上：这一行是 30 天，不是上面那行的自然月
    expect(screen.getByText('近 30 天成功率')).toBeTruthy();
  });

  it('成功率为 null 时不显示这一行 —— 「没跑过」不是「0%」', () => {
    renderCard({
      usage: {
        activeUserCount30d: 1,
        grantedUserCount: 1,
        grantedDepartmentCount: 1,
        grantedMemberCount: 0,
        lastUsedAt: null,
        monthCostCNY: '0.00',
        monthCallCount: 0,
        executionCount30d: 0,
        successRate30d: null,
      },
    });

    expect(screen.queryByText('近 30 天成功率')).toBeNull();
    // 从未使用要说清楚，不能渲染成很久以前
    expect(screen.getByText('从未使用')).toBeTruthy();
  });

  it('赠送额度画进度条，条子长度与文案同向（都是剩余）', () => {
    renderCard({
      giftStatus: 'ACTIVE',
      giftGrantedCNY: '100.00',
      giftRemainingCNY: '75.00',
    });

    const bar = screen.getByRole('progressbar', { name: '赠送算力剩余比例' });
    expect(bar.getAttribute('aria-valuenow')).toBe('75');
    expect(screen.getByText('剩余 ¥75.00 / ¥100.00')).toBeTruthy();
    // 额度充足时必须是**绿色且铺开**的 —— 画成已用比例会让健康的额度显示成一条空槽
    const fill = bar.firstElementChild as HTMLElement;
    expect(fill.style.width).toBe('75%');
    expect(fill.className).toContain('bg-success');
  });

  it('剩余不足两成时条子转黄', () => {
    renderCard({
      giftStatus: 'ACTIVE',
      giftGrantedCNY: '100.00',
      giftRemainingCNY: '10.00',
    });

    const fill = screen.getByRole('progressbar').firstElementChild as HTMLElement;
    expect(fill.className).toContain('bg-warning');
    expect(fill.className).not.toContain('bg-success');
  });

  it('赠送额度用尽时说明会转扣企业钱包，整条槽染红', () => {
    renderCard({
      giftStatus: 'EXHAUSTED',
      giftGrantedCNY: '100.00',
      giftRemainingCNY: '0.00',
    });

    expect(screen.getByText(/后续消费从企业钱包扣除/)).toBeTruthy();
    // 剩余 0 时填充是 0 宽度，承载不了颜色 —— 危险信号必须落在槽上
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('0');
    expect(bar.className).toContain('bg-danger');
  });

  it('没有赠送记录时不画进度条', () => {
    renderCard();

    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});
