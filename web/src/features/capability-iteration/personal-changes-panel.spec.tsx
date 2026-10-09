import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PersonalChangesPanel } from './personal-changes-panel';

const { usePersonalDiffs, updatePersonal, createPersonal, success } = vi.hoisted(() => ({ usePersonalDiffs: vi.fn(), updatePersonal: vi.fn(), createPersonal: vi.fn(), success: vi.fn() }));

vi.mock('@/components/ui/toast', () => ({ toast: { success, error: vi.fn() } }));

vi.mock('./use-capability-iteration', () => ({
  usePersonalDiffs,
  useAdoptPersonalVersions: () => ({ isPending: false, mutate: vi.fn() }),
  useCreatePersonalVersion: () => ({ isPending: false, mutate: createPersonal }),
  useDiscardPersonalVersion: () => ({ isPending: false, mutate: vi.fn() }),
  useUpdatePersonalVersion: () => ({ isPending: false, mutate: updatePersonal }),
}));

describe('PersonalChangesPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('副本已保存不代表已使用，明确说明编辑不覆盖个人选择', () => {
    render(<PersonalChangesPanel capabilityId="cap-1" currentUserId="admin" />);
    expect(screen.getByText('已保存')).toBeInTheDocument();
    expect(screen.queryByText('已生效')).not.toBeInTheDocument();
    expect(screen.getByText(/使用该副本时，保存后下一次执行采用新内容；可在版本记录选择使用副本/)).toBeInTheDocument();
    expect(screen.getByText(/保存不会覆盖已选的平台版、企业版或跟随企业设置/)).toBeInTheDocument();
  });

  it('保存只编辑正文，成功提示不声称所有订阅立即切到副本', () => {
    updatePersonal.mockImplementation((_payload, options) => options.onSuccess());
    render(<PersonalChangesPanel capabilityId="cap-1" currentUserId="admin" />);
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: '更新正文' } });
    fireEvent.click(screen.getByRole('button', { name: '保存副本' }));
    expect(updatePersonal).toHaveBeenCalledWith({ versionId: 'admin-copy', content: '更新正文', changeSummary: '管理员自己的改动' }, expect.any(Object));
    expect(success).toHaveBeenCalledWith('已保存', '使用该副本时，保存后下一次执行采用新内容；可在版本记录选择使用副本');
    expect(screen.queryByRole('button', { name: '保存并生效' })).not.toBeInTheDocument();
  });

  it('创建文案区分新建与返回存量副本，不宣称覆盖其他订阅', () => {
    usePersonalDiffs.mockReturnValue({ isLoading: false, isError: false, data: { canManage: false, baseline: null, items: [] } });
    createPersonal.mockImplementation((_payload, options) => options.onSuccess());
    render(<PersonalChangesPanel capabilityId="cap-1" currentUserId="member" />);
    expect(screen.getByText(/新建副本会在本次授权订阅使用，不影响其他订阅的个人选择/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '创建我的副本' }));
    expect(success).toHaveBeenCalledWith('我的副本已保存', '新建副本会在本次授权订阅使用；已有副本不会自动切版，可在版本记录选择使用副本');
  });

});
