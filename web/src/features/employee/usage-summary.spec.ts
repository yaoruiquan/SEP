import { describe, it, expect } from 'vitest';
import {
  formatLastUsed,
  formatSuccessRate,
  giftProgress,
  summarizeEmployees,
} from './usage-summary';
import type { MyEmployee } from '@/lib/types';

/** 只填卡片口径关心的字段，其余用最小骨架 */
const employee = (patch: Partial<MyEmployee> = {}): MyEmployee =>
  ({
    subscriptionId: 'sub-1',
    name: '客服小助手',
    templateVersion: '1.0.0',
    employee: { id: 't1', name: '客服', avatar: null },
    department: null,
    grantSource: 'DIRECT',
    expiresAt: null,
    ...patch,
  }) as MyEmployee;

const usage = (patch: Partial<NonNullable<MyEmployee['usage']>> = {}) => ({
  activeUserCount30d: 0,
  grantedUserCount: 0,
  grantedDepartmentCount: 0,
  grantedMemberCount: 0,
  lastUsedAt: null,
  monthCostCNY: '0.00',
  monthCallCount: 0,
  executionCount30d: 0,
  successRate30d: null,
  ...patch,
});

describe('formatLastUsed', () => {
  it('从未使用时给出文字，而不是 1970 或「56 年前」', () => {
    expect(formatLastUsed(null)).toBe('从未使用');
    expect(formatLastUsed(undefined)).toBe('从未使用');
  });

  it('脏数据不渲染成 Invalid Date', () => {
    expect(formatLastUsed('not-a-date')).toBe('从未使用');
  });

  it('有时间时给相对描述', () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 86400_000).toISOString();

    const text = formatLastUsed(twoDaysAgo);

    expect(text).toContain('前');
    expect(text).not.toBe('从未使用');
  });
});

describe('formatSuccessRate', () => {
  it('null 留破折号 —— 「没跑过」不是「0%」', () => {
    expect(formatSuccessRate(null)).toBe('—');
    expect(formatSuccessRate(undefined)).toBe('—');
  });

  it('0 是真实的 0%，不能被当成缺失', () => {
    expect(formatSuccessRate(0)).toBe('0%');
  });

  it('正常值带百分号', () => {
    expect(formatSuccessRate(96)).toBe('96%');
  });
});

describe('giftProgress', () => {
  it('没有赠送记录时不画进度条', () => {
    expect(giftProgress(employee())).toBeNull();
    expect(giftProgress(employee({ giftStatus: 'NONE' }))).toBeNull();
  });

  it('赠送额度为 0 时不画进度条 —— 否则要除以零', () => {
    expect(
      giftProgress(
        employee({
          giftStatus: 'ACTIVE',
          giftGrantedCNY: '0.00',
          giftRemainingCNY: '0.00',
        }),
      ),
    ).toBeNull();
  });

  it('进度条画的是剩余比例 —— 与旁边的「剩余 ¥x / ¥y」同向', () => {
    const progress = giftProgress(
      employee({
        giftStatus: 'ACTIVE',
        giftGrantedCNY: '100.00',
        giftRemainingCNY: '75.00',
      }),
    );

    expect(progress).toMatchObject({
      remainingPercent: 75,
      remainingCNY: 75,
      grantedCNY: 100,
      low: false,
      exhausted: false,
    });
  });

  it('剩余不足两成算「快用完」', () => {
    const progress = giftProgress(
      employee({
        giftStatus: 'ACTIVE',
        giftGrantedCNY: '100.00',
        giftRemainingCNY: '20.00',
      }),
    );

    expect(progress?.low).toBe(true);
    expect(progress?.exhausted).toBe(false);
  });

  it('用尽时标记 exhausted，剩余比例归零', () => {
    const progress = giftProgress(
      employee({
        giftStatus: 'EXHAUSTED',
        giftGrantedCNY: '100.00',
        giftRemainingCNY: '0.00',
      }),
    );

    expect(progress).toMatchObject({
      remainingPercent: 0,
      exhausted: true,
      low: true,
    });
  });

  it('剩余大于赠送（脏数据）时比例封顶 100，不溢出槽外', () => {
    const progress = giftProgress(
      employee({
        giftStatus: 'ACTIVE',
        giftGrantedCNY: '50.00',
        giftRemainingCNY: '80.00',
      }),
    );

    expect(progress?.remainingPercent).toBe(100);
  });
});

describe('summarizeEmployees', () => {
  it('空列表给零值而非 NaN', () => {
    expect(summarizeEmployees([])).toEqual({
      employeeCount: 0,
      monthCostCNY: '0.00',
      lowGiftCount: 0,
    });
  });

  it('本月消费按元累加并保留两位小数', () => {
    const summary = summarizeEmployees([
      employee({ subscriptionId: 'a', usage: usage({ monthCostCNY: '12.40' }) }),
      employee({ subscriptionId: 'b', usage: usage({ monthCostCNY: '74.00' }) }),
    ]);

    expect(summary.monthCostCNY).toBe('86.40');
    expect(summary.employeeCount).toBe(2);
  });

  it('没有使用情况的员工按 0 计，不污染合计', () => {
    const summary = summarizeEmployees([
      employee({ subscriptionId: 'a', usage: usage({ monthCostCNY: '10.00' }) }),
      employee({ subscriptionId: 'b' }),
    ]);

    expect(summary.monthCostCNY).toBe('10.00');
  });

  it('数出赠送额度快用完的人数', () => {
    const summary = summarizeEmployees([
      employee({
        subscriptionId: 'a',
        giftStatus: 'ACTIVE',
        giftGrantedCNY: '100.00',
        giftRemainingCNY: '5.00',
      }),
      employee({
        subscriptionId: 'b',
        giftStatus: 'ACTIVE',
        giftGrantedCNY: '100.00',
        giftRemainingCNY: '90.00',
      }),
      // 没有赠送记录的不该被算成「快用完」
      employee({ subscriptionId: 'c' }),
    ]);

    expect(summary.lowGiftCount).toBe(1);
  });
});
