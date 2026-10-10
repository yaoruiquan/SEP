import { describe, expect, it, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ContributionCreateDialog } from './contribution-create-dialog';
import type { RpaPackageParseResult } from '../../../../backend/src/shared';

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
const uploadRpaMutation = vi.fn();

vi.mock('./use-contributions', () => ({
  useCreateContribution: () => ({ mutate: createMutation, isPending: false }),
  useUploadSkillPackage: () => ({ mutate: uploadMutation, isPending: false }),
  useUploadRpaPackage: () => ({ mutateAsync: uploadRpaMutation, isPending: false }),
}));

vi.mock('@/lib/auth-store', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({ enterprise: { id: 'e1', name: '示例企业' } }),
}));

const RPA_PARSED: RpaPackageParseResult = {
  sha256: 'c'.repeat(64),
  filename: 'invoice-rpa.zip',
  fileCount: 4,
  totalBytes: 2048,
  uncompressedBytes: 4096,
  files: ['main.exe'],
};

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ContributionCreateDialog open onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  );
}

function goToContentStep() {
  fireEvent.click(screen.getByRole('button', { name: /下一步/ }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('创建能力贡献', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    }));
    createMutation.mockReset();
    uploadMutation.mockReset();
    uploadRpaMutation.mockReset();
    uploadRpaMutation.mockResolvedValue(RPA_PARSED);
  });

  it('无 SKILL 创建选项和上传入口，默认进入 RPA 内容', () => {
    renderDialog();
    expect(screen.queryByRole('button', { name: /^Skill/i })).not.toBeInTheDocument();
    goToContentStep();
    expect(screen.queryByText('点击选择 SKILL ZIP 包')).not.toBeInTheDocument();
    expect(screen.getByText('点击选择 RPA ZIP 包')).toBeInTheDocument();
    expect(document.querySelector('input[type="file"][accept=".zip,application/zip"]')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /下一步/ })).toBeDisabled();
    expect(uploadMutation).not.toHaveBeenCalled();
    expect(createMutation).not.toHaveBeenCalled();
  });

  it('RPA 缺少包或使用说明时不能创建', () => {
    renderDialog();
    goToContentStep();
    fireEvent.change(screen.getByPlaceholderText(/账号\/环境要求/), { target: { value: '完整的使用与环境说明已经填写' } });
    expect(screen.getByRole('button', { name: /下一步/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /下一步/ }));
    expect(screen.queryByRole('button', { name: /创建草稿/ })).not.toBeInTheDocument();
    expect(createMutation).not.toHaveBeenCalled();
  });

  it('RPA 保留自己的 ZIP 上传流程', async () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /^RPA/ }));
    goToContentStep();

    expect(screen.getByText('上传可复用的自动化流程')).toBeInTheDocument();
    expect(screen.getByText('点击选择 RPA ZIP 包')).toBeInTheDocument();
    expect(screen.queryByText('上传 SKILL ZIP 包')).not.toBeInTheDocument();
    const input = document.querySelector('input[type="file"][accept=".zip,application/zip"]') as HTMLInputElement;
    expect(input).toBeTruthy();

    const file = new File(['rpa'], 'invoice-rpa.zip', { type: 'application/zip' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByText('invoice-rpa.zip')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/账号\/环境要求/), {
      target: { value: '需要安装影刀客户端并配置发票目录，审核通过后下载使用。' },
    });
    fireEvent.click(screen.getByRole('button', { name: /下一步/ }));
    fireEvent.change(screen.getByPlaceholderText(/竞品周报生成器/), { target: { value: '发票 RPA' } });
    fireEvent.change(screen.getByPlaceholderText(/说明它解决什么问题/), { target: { value: '自动处理发票并生成归档结果' } });
    fireEvent.click(screen.getByRole('button', { name: /创建草稿/ }));

    const [body] = createMutation.mock.calls[0] as [{ type: string; skillConfig?: unknown; rpaConfig: Record<string, unknown> }];
    expect(body.type).toBe('rpa');
    expect(body.skillConfig).toBeUndefined();
    expect(uploadMutation).not.toHaveBeenCalled();
    expect(body.rpaConfig).toMatchObject({ packageSha256: 'c'.repeat(64), packageFilename: 'invoice-rpa.zip' });
  });
});
