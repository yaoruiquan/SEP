import { describe, expect, it, vi, beforeAll, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { QuotaBlockedDialog } from './quota-blocked-dialog';
import { useAuthStore } from '@/lib/auth-store';
import type { ComputeBlockedInfo } from './use-chat-stream';

/**
 * 这个弹窗只有一件事要做对：**把人指到正确的下一步**。
 *
 * 「额度用尽」和「企业没钱了」是两回事 —— 前者公司账上有钱、要找管理员调额度，
 * 后者要给企业钱包充值。两者都写成「余额不足」，成员就会去催财务充值，
 * 而钱其实一直是够的。所以标题与第二条出路必须随 blockedBy 变。
 */

// jsdom 没有 matchMedia，DialogContent 走 usePrefersReducedMotion。
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

const ALLOWANCE_REASON =
  '你本月的算力额度已用完，个人余额也已用尽。额度将于 2026年10月1日 重置；' +
  '需要提前恢复，可联系企业管理员调高额度或追加一次性额度，也可为个人余额充值后自费使用。';

function info(over: Partial<ComputeBlockedInfo> = {}): ComputeBlockedInfo {
  return {
    message: ALLOWANCE_REASON,
    blockedBy: 'ALLOWANCE',
    personalBalanceCNY: '0.00',
    ...over,
  };
}

const onClose = vi.fn();

function renderDialog(value: ComputeBlockedInfo | null = info()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <QuotaBlockedDialog info={value} onClose={onClose} />
    </QueryClientProvider>,
  );
}

function asMember() {
  useAuthStore.setState({
    token: 't',
    user: { id: 'u1', email: 'a@b.c', name: '测试', role: 'USER' },
    enterprise: { id: 'ent1', name: '示例科技' },
    roleInEnterprise: 'MEMBER',
    hydrated: true,
  });
}

describe('QuotaBlockedDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    asMember();
  });

  it('info 为空时不渲染', () => {
    renderDialog(null);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('后端 reason 原样展示 —— 重置时间不在前端二次拼装', () => {
    renderDialog();
    expect(screen.getByText(ALLOWANCE_REASON)).toBeInTheDocument();
  });

  it('额度用尽：标题指向额度，成员的第二条出路是看自己的额度', () => {
    renderDialog();
    expect(screen.getByText('算力额度已用尽')).toBeInTheDocument();
    // 锚点必须落在「算力余额」页上：额度那一屏就在那里，
    // 指到「硅基员工」页（它以前挂在那）会跳到一个没有这块内容的页面
    expect(screen.getByRole('link', { name: /查看我的额度/ })).toHaveAttribute(
      'href',
      '/compute-quota#my-compute',
    );
    // reason 里也有「联系企业管理员」，所以锚到前端自己那句，别测成后端文案
    expect(screen.getByText(/^要继续用公司额度/)).toBeInTheDocument();
  });

  it('❗企业没钱：标题与出路都换成充值，不能说成「额度用尽」', () => {
    renderDialog(info({ blockedBy: 'BALANCE', message: '企业算力余额不足。' }));
    expect(screen.getByText('企业算力余额不足')).toBeInTheDocument();
    expect(screen.getByText(/^要继续用公司资金/)).toBeInTheDocument();
    // 成员这条路也通向「算力余额」页 —— 他在那里能看到自己的个人余额
    expect(screen.getByRole('link', { name: /查看我的算力/ })).toHaveAttribute(
      'href',
      '/compute-quota#my-compute',
    );
  });

  it('管理员被拦下时直接给可操作入口，而不是让他去联系自己', () => {
    useAuthStore.setState({ roleInEnterprise: 'ENTERPRISE_ADMIN' });

    renderDialog(info({ blockedBy: 'BALANCE' }));
    expect(screen.getByRole('link', { name: /给企业钱包充值/ })).toHaveAttribute(
      'href',
      '/wallet',
    );
    // 让管理员「去联系企业管理员」等于把人踢回原地
    expect(screen.queryByText(/^要继续用公司/)).not.toBeInTheDocument();
  });

  it('管理员的额度出路指向算力分配面板', () => {
    useAuthStore.setState({ roleInEnterprise: 'ENTERPRISE_ADMIN' });

    renderDialog();
    expect(screen.getByRole('link', { name: /去调整额度/ })).toHaveAttribute(
      'href',
      '/compute-quota',
    );
  });

  it('个人余额如实显示 —— 被拦下时通常是 ¥0.00', () => {
    renderDialog(info({ personalBalanceCNY: '8.50' }));
    expect(screen.getByText('¥8.50')).toBeInTheDocument();
  });

  it('说明自付不会让「本周期已用」增长（§5.5 #4 的判据）', () => {
    renderDialog();
    expect(
      screen.getByText(/「本周期已用」不会因此增长/),
    ).toBeInTheDocument();
  });

  it('❗点个人充值先关掉自己 —— 两层 Dialog 同时在场会互相抢焦点', () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /个人余额充值/ }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('关闭按钮回调 onClose', () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
