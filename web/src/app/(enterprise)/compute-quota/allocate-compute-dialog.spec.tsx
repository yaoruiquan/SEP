import { describe, expect, it, vi, beforeAll, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AllocateComputeDialog } from './allocate-compute-dialog';
import type { MemberAllowanceItem } from '@/lib/api/use-compute-credit';

// jsdom 没有 matchMedia，而 DialogContent 走 usePrefersReducedMotion。
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

const setAllowance = vi.fn();

vi.mock('@/lib/api/use-compute-credit', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/api/use-compute-credit')
  >('@/lib/api/use-compute-credit');
  return {
    ...actual,
    useSetMemberAllowance: () => ({ mutate: setAllowance, isPending: false }),
  };
});

function member(over: Partial<MemberAllowanceItem> = {}): MemberAllowanceItem {
  return {
    userId: 'user-1',
    name: '技术负责人',
    email: 'dev@acme.local',
    departmentName: '技术部',
    limitCNY: null,
    enabled: true,
    usedCNY: '0.0000',
    remainingCNY: null,
    usedPct: null,
    resetAt: '2026-09-30T16:00:00.000Z',
    ...over,
  };
}

function open(item = member()) {
  render(<AllocateComputeDialog member={item} trigger={<button>分配算力</button>} />);
  fireEvent.click(screen.getByText('分配算力'));
}

describe('AllocateComputeDialog', () => {
  beforeEach(() => setAllowance.mockClear());

  it('弹窗里必须有确定按钮 —— 只有「取消」等于这个功能不存在', () => {
    open();
    // 未填金额时确认按钮表达的是「改为不限额」，填了金额才变「保存额度」，
    // 但任何状态下都必须存在一个能提交的按钮
    expect(screen.getByRole('button', { name: /改为不限额/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('每月算力额度（元）'), {
      target: { value: '500' },
    });
    expect(screen.getByRole('button', { name: /保存额度/ })).toBeInTheDocument();
  });

  it('填了金额点保存，按元提交给后端', () => {
    open();
    fireEvent.change(screen.getByLabelText('每月算力额度（元）'), {
      target: { value: '500' },
    });
    fireEvent.click(screen.getByRole('button', { name: /保存额度/ }));

    expect(setAllowance).toHaveBeenCalledWith(
      { userId: 'user-1', limitCNY: 500 },
      expect.anything(),
    );
  });

  it('留空 = 不限额，按钮文案跟着变，提交 null', () => {
    open(member({ limitCNY: '200.00' }));
    fireEvent.change(screen.getByLabelText('每月算力额度（元）'), {
      target: { value: '' },
    });

    fireEvent.click(screen.getByRole('button', { name: /改为不限额/ }));
    expect(setAllowance).toHaveBeenCalledWith(
      { userId: 'user-1', limitCNY: null },
      expect.anything(),
    );
  });

  it('快捷额度按钮把金额填进输入框', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: '¥500/月' }));
    expect(screen.getByLabelText('每月算力额度（元）')).toHaveValue(500);
  });

  it('金额非法时保存按钮禁用，不会发请求', () => {
    open();
    fireEvent.change(screen.getByLabelText('每月算力额度（元）'), {
      target: { value: '-3' },
    });

    const save = screen.getByRole('button', { name: /保存额度/ });
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(setAllowance).not.toHaveBeenCalled();
  });

  it('新额度低于本月已花时先警告，别让管理员误伤成员', () => {
    open(member({ usedCNY: '120.0000' }));
    fireEvent.change(screen.getByLabelText('每月算力额度（元）'), {
      target: { value: '50' },
    });
    expect(screen.getByText(/超过这个额度/)).toBeInTheDocument();
  });
});
