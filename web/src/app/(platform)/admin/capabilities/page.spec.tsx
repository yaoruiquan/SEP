import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CapabilitiesPage from './page';

const { list } = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('@/features/admin/use-admin', () => ({
  useAllCapabilities: list,
  useApproveCapability: () => ({ mutate: vi.fn() }),
  useRejectCapability: () => ({ mutate: vi.fn() }),
  useDeleteCapability: () => ({ mutate: vi.fn() }),
}));

describe('能力管理监控入口', () => {
  beforeEach(() => {
    list.mockReturnValue({ data: { items: [] } });
  });
  it('只有一个技能监控入口，无待审计数，保留新建能力', () => {
    render(<CapabilitiesPage />);
    expect(screen.getAllByRole('link', { name: '技能监控' })).toHaveLength(1);
    expect(screen.getByRole('link', { name: '技能监控' })).toHaveAttribute('href', '/admin/skills');
    expect(screen.getByRole('link', { name: /新建能力/ })).toHaveAttribute('href', '/admin/capabilities/new');
    expect(screen.queryByText('投稿待审')).not.toBeInTheDocument();
    expect(screen.queryByText('版本待审')).not.toBeInTheDocument();
    expect(screen.queryByText(/两个队列/)).not.toBeInTheDocument();
  });
  it('非技能企业投稿保留行内审核入口', () => {
    list.mockReturnValue({ data: { items: [{ id: 'rpa-1', name: '对账自动化', description: 'RPA',
      type: 'RPA', status: 'PENDING', enterpriseId: 'e-1', enterprise: { name: '测试企业' },
      platformReviewStatus: 'PENDING_REVIEW', createdAt: '2026-10-10T00:00:00Z',
      _count: { bindings: 0 }, bindings: [] }] } });
    render(<CapabilitiesPage />);
    expect(screen.getByRole('link', { name: /审核/ })).toHaveAttribute('href', '/admin/contributions?selected=rpa-1');
  });
});
