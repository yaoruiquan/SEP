import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SkillVersionEditPage from './page';
const mocks = vi.hoisted(() => ({ redirect: vi.fn(), preview: vi.fn() }));
vi.mock('next/navigation', () => ({ useParams: () => ({ versionId: 'old-version' }), redirect: mocks.redirect }));
vi.mock('@/features/skill-version/use-skill-version', () => ({ useSkillVersionPreview: mocks.preview }));
beforeEach(() => { vi.clearAllMocks(); });
describe('旧企业编辑 URL 只读跳转', () => {
  it.each(['DRAFT', 'ENTERPRISE_REJECTED', 'ENTERPRISE_APPROVED'])('%s同样只读取授权预览并跳转对应技能', (status) => {
    mocks.preview.mockReturnValue({ data: { capabilityId: 'cap-1', status } });
    render(<SkillVersionEditPage />);
    expect(mocks.preview).toHaveBeenCalledWith('old-version', 'enterprise');
    expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith('/capabilities/cap-1');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /保存|发布/ })).not.toBeInTheDocument();
  });
  it('授权失败留在只读错误页，不使用外部returnTo或猜测技能ID', () => {
    mocks.preview.mockReturnValue({ isError: true, error: new Error('无访问权限') });
    render(<SkillVersionEditPage />);
    expect(screen.getByText('无访问权限')).toBeVisible();
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: '返回技能库' })).toHaveAttribute('href', '/capabilities');
  });
  it('加载期间没有编辑表单', () => {
    mocks.preview.mockReturnValue({ isLoading: true });
    render(<SkillVersionEditPage />);
    expect(screen.getByText('正在打开只读技能详情…')).toBeVisible();
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});
