import { describe, expect, it, vi, beforeAll, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ContributionCreateDialog } from './contribution-create-dialog';
import type { SkillPackageParseResult } from '../../../../backend/src/shared';

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

const createMutation = vi.fn();
const uploadMutation = vi.fn();

vi.mock('./use-contributions', () => ({
  useCreateContribution: () => ({ mutate: createMutation, isPending: false }),
  useUploadSkillPackage: () => ({ mutate: uploadMutation, isPending: false }),
}));

vi.mock('@/lib/auth-store', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({ enterprise: { id: 'e1', name: '示例企业' } }),
}));

const PARSED: SkillPackageParseResult = {
  sha256: 'a'.repeat(64),
  filename: '竞品周报.zip',
  fileCount: 3,
  totalBytes: 4096,
  content: '# 角色\n你是竞品分析助手。\n# 输入\n竞品列表\n# 步骤\n1. 收集\n# 输出\n周报',
  suggested: { name: '竞品周报生成器', description: '每周汇总竞品动态并输出周报' },
  validation: {
    valid: true,
    checks: [{ code: 'CONTENT_LENGTH', passed: true, message: 'Skill 正文至少需要 20 个字符' }],
    issues: [],
    warnings: [],
  },
};

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ContributionCreateDialog open onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  );
}

/** 走到第二步（能力内容）。第一步的 Skill 是默认选中的。 */
function goToContentStep() {
  fireEvent.click(screen.getByRole('button', { name: /下一步/ }));
}

/** 触发一次成功的包上传，回调里喂进解析结果。 */
function uploadPackage(result: SkillPackageParseResult = PARSED) {
  const file = new File(['zip bytes'], 'competitor.zip', { type: 'application/zip' });
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
  const [, options] = uploadMutation.mock.calls.at(-1) as [File, { onSuccess: (r: SkillPackageParseResult) => void }];
  // onSuccess 是 mutation 回调，手动调用要包 act，否则 setState 不 flush
  act(() => options.onSuccess(result));
}

describe('创建能力贡献', () => {
  beforeEach(() => {
    createMutation.mockReset();
    uploadMutation.mockReset();
  });

  it('第二步是能力内容，上传是默认路径', () => {
    renderDialog();
    // 步骤条顺序：类型 → 能力内容 → 能力信息
    expect(screen.getByLabelText('创建步骤').textContent).toMatch(/选择类型.*能力内容.*能力信息/);

    goToContentStep();
    expect(screen.getByText('上传它的 SKILL 包')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '上传 SKILL 包' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/拖入 zip 包/)).toBeInTheDocument();
  });

  it('没上传包时不能进入下一步', () => {
    renderDialog();
    goToContentStep();
    expect(screen.getByRole('button', { name: /下一步/ })).toBeDisabled();
  });

  it('上传成功后展示包信息与校验结论', () => {
    renderDialog();
    goToContentStep();
    uploadPackage();

    expect(screen.getByText('竞品周报.zip')).toBeInTheDocument();
    expect(screen.getByText(/3 个文件/)).toBeInTheDocument();
    // sha256 截断展示，便于核对
    expect(screen.getByText(/sha256 aaaaaaaaaaaa/)).toBeInTheDocument();
    expect(screen.getByText('自动校验通过')).toBeInTheDocument();
  });

  it('frontmatter 预填名称与说明', async () => {
    renderDialog();
    goToContentStep();
    uploadPackage();
    fireEvent.click(screen.getByRole('button', { name: /下一步/ }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/竞品周报生成器/)).toHaveValue('竞品周报生成器');
    });
    expect(screen.getByText(/已从 SKILL.md 的 frontmatter 预填/)).toBeInTheDocument();
  });

  it('上传路径只提交 sha256，不提交正文', async () => {
    renderDialog();
    goToContentStep();
    uploadPackage();
    fireEvent.click(screen.getByRole('button', { name: /下一步/ }));
    await waitFor(() => screen.getByRole('button', { name: /创建草稿/ }));
    fireEvent.click(screen.getByRole('button', { name: /创建草稿/ }));

    const [body] = createMutation.mock.calls[0] as [Record<string, unknown>];
    expect(body.skillConfig).toEqual({
      packageSha256: 'a'.repeat(64),
      packageFilename: '竞品周报.zip',
    });
    // 正文绝不能跟着走 —— 服务端按 sha256 重新解包才是唯一来源
    expect(JSON.stringify(body)).not.toContain('你是竞品分析助手');
  });

  it('在线编写路径提交 template', async () => {
    renderDialog();
    goToContentStep();
    fireEvent.click(screen.getByRole('button', { name: '在线编写' }));
    fireEvent.change(screen.getByPlaceholderText(/# 角色/), {
      target: { value: '# 角色\n手写的正文，长度足够通过前端下限校验' },
    });
    fireEvent.click(screen.getByRole('button', { name: /下一步/ }));

    fireEvent.change(screen.getByPlaceholderText(/竞品周报生成器/), { target: { value: '手写能力' } });
    fireEvent.change(screen.getByPlaceholderText(/说明它解决什么问题/), {
      target: { value: '这是一段足够长的能力说明' },
    });
    fireEvent.click(screen.getByRole('button', { name: /创建草稿/ }));

    const [body] = createMutation.mock.calls[0] as [{ skillConfig: Record<string, unknown> }];
    expect(body.skillConfig.template).toContain('手写的正文');
    expect(body.skillConfig.packageSha256).toBeUndefined();
  });

  it('校验未通过仍可创建草稿，但会说明门禁在提交审核那一步', () => {
    renderDialog();
    goToContentStep();
    uploadPackage({
      ...PARSED,
      validation: {
        valid: false,
        checks: [
          { code: 'SECTION_INPUT', passed: false, message: 'Skill 正文需要包含“input”段落' },
          { code: 'CONTENT_LENGTH', passed: true, message: 'Skill 正文至少需要 20 个字符' },
        ],
        issues: [{ code: 'SECTION_INPUT', message: 'Skill 正文需要包含“input”段落' }],
        warnings: [],
      },
    });

    expect(screen.getByText('还有 1 项待补齐')).toBeInTheDocument();
    expect(screen.getByText(/现在仍可创建草稿/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /下一步/ })).not.toBeDisabled();
  });
});
