import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PersonalChangesPanel } from './personal-changes-panel';

const { usePersonalDiffs } = vi.hoisted(() => ({ usePersonalDiffs: vi.fn() }));

vi.mock('./use-capability-iteration', () => ({
  usePersonalDiffs,
  useAdoptPersonalVersions: () => ({ isPending: false, mutate: vi.fn() }),
  useCreatePersonalVersion: () => ({ isPending: false, mutate: vi.fn() }),
  useDiscardPersonalVersion: () => ({ isPending: false, mutate: vi.fn() }),
  useUpdatePersonalVersion: () => ({ isPending: false, mutate: vi.fn() }),
}));

describe('PersonalChangesPanel', () => {
  beforeEach(() => {
    usePersonalDiffs.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        canManage: true,
        baseline: { id: 'base', scope: 'ENTERPRISE', version: '1.0.0', content: 'base' },
        items: [
          {
            id: 'admin-copy',
            owner: { id: 'admin', name: '企业管理员', email: 'admin@example.com' },
            basedOn: null,
            changeSummary: '管理员自己的改动',
            content: 'admin change',
            updatedAt: '2026-09-08T00:00:00.000Z',
            adopted: false,
            adoptedAt: null,
            pending: true,
          },
          {
            id: 'member-copy',
            owner: { id: 'member', name: '普通成员', email: 'member@example.com' },
            basedOn: null,
            changeSummary: '成员改动',
            content: 'member change',
            updatedAt: '2026-09-08T00:00:00.000Z',
            adopted: false,
            adoptedAt: null,
            pending: true,
          },
        ],
      },
    });
  });

  it('企业管理员的副本也显示在大家的改动中', () => {
    render(<PersonalChangesPanel capabilityId="cap-1" currentUserId="admin" />);

    expect(screen.getByText('企业管理员')).toBeInTheDocument();
    expect(screen.getByText('普通成员')).toBeInTheDocument();
  });

  it('普通成员不把自己的副本重复显示在大家的改动中', () => {
    usePersonalDiffs.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        canManage: false,
        baseline: null,
        items: [
          {
            id: 'member-copy',
            owner: { id: 'member', name: '普通成员', email: 'member@example.com' },
            basedOn: null,
            changeSummary: null,
            content: 'member change',
            updatedAt: '2026-09-08T00:00:00.000Z',
            adopted: false,
            adoptedAt: null,
            pending: true,
          },
        ],
      },
    });

    render(<PersonalChangesPanel capabilityId="cap-1" currentUserId="member" />);

    expect(screen.queryByText('普通成员')).not.toBeInTheDocument();
    expect(screen.getByText('我的副本')).toBeInTheDocument();
  });
});
