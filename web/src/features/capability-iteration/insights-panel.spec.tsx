import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InsightsPanel } from './insights-panel';

const mocks = vi.hoisted(() => ({ generate: vi.fn(), dismiss: vi.fn() }));
vi.mock('./use-capability-iteration', () => ({
  useCapabilityInsights: () => ({ data: [{
    id: 'insight', scope: 'ALL', status: 'PENDING', createdAt: '2026-10-09T00:00:00Z',
    sampleSize: 3, personalCount: 2,
    findings: [{ phenomenon: '多次遗漏', suggestion: '补充说明', confidence: 0.9 }],
  }] }),
  usePersonalDiffs: () => ({ data: { items: [] } }),
  useGenerateInsight: () => ({ mutate: mocks.generate, isPending: false }),
  useResolveInsight: () => ({ dismiss: { mutate: mocks.dismiss, isPending: false } }),
}));
beforeEach(() => { vi.clearAllMocks(); });

describe('AI 建议只读', () => {
  it('保留分析和拒绝，不提供采纳编辑或正文输入', () => {
    render(<InsightsPanel capabilityId="cap" canManage />);
    expect(screen.getByText('补充说明')).toBeVisible();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /采纳|编辑正文/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '一键分析全部使用者' }));
    expect(mocks.generate).toHaveBeenCalledWith({ scope: 'ALL' }, expect.any(Object));
    fireEvent.click(screen.getByRole('button', { name: '拒绝' }));
    expect(mocks.dismiss).toHaveBeenCalledWith('insight', expect.any(Object));
  });
  it('普通成员没有分析或处理建议入口', () => {
    render(<InsightsPanel capabilityId="cap" canManage={false} />);
    expect(screen.getByText('迭代建议仅企业管理员可见')).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.dismiss).not.toHaveBeenCalled();
  });
});
