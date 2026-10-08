import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SkillVersionEditPage from './page';

vi.mock('next/navigation', () => ({
  useParams: () => ({ versionId: 'version-1' }),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/features/skill-version/use-skill-version', () => ({
  useSkillVersionPreview: () => ({
    data: {
      capability: { name: '用户需求挖掘' },
      version: '1.0.0', status: 'DRAFT', content: '技能正文', changeSummary: '初始版本',
    },
    isLoading: false,
  }),
  useUpdateEnterpriseSkillVersion: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePublishEnterpriseSkillVersion: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/features/chat/markdown', () => ({
  Markdown: ({ content }: { content: string }) => <p>{content}</p>,
}));

describe('技能版本编辑页宽度', () => {
  it('编辑和正文预览都撑满 flex 父容器，并保留最大宽度', () => {
    const { container } = render(<div className="flex flex-col"><SkillVersionEditPage /></div>);
    const page = container.firstElementChild?.firstElementChild;
    expect(page).toHaveClass('mx-auto', 'w-full', 'max-w-7xl');
    expect(screen.getByDisplayValue('技能正文')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '预览效果' }));
    expect(screen.getByText('技能正文')).toBeVisible();
    expect(page).toHaveClass('w-full', 'max-w-7xl');
  });
});
