import { describe, expect, it, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ContributionCreateDialog } from './contribution-create-dialog';
import type { RpaPackageParseResult, SkillPackageParseResult } from '../../../../backend/src/shared';

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

vi.mock('./components/local-skill-scanner', () => ({
  LocalSkillScanner: ({ onPackaged }: { onPackaged: (file: File) => void }) => (
    <div>
      <button type="button">扫描本地 Skills</button>
      <button type="button" onClick={() => onPackaged(new File(['zip bytes'], '竞品周报.zip', { type: 'application/zip' }))}>确认导入选中的 Skill</button>
    </div>
  ),
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

function mockBridge() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/scan')) {
      return new Response(JSON.stringify({
        scannerVersion: '0.2.0',
        items: [{
          id: 'a'.repeat(64),
          name: '竞品周报',
          description: '汇总竞品动态',
          path: '/Users/test/.claude/skills/weekly',
          source: 'claude-code',
          scope: 'user',
          sha256: 'b'.repeat(64),
          fileCount: 2,
          totalBytes: 1024,
          files: ['SKILL.md', 'examples/input.txt'],
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('zip bytes', {
      status: 200,
      headers: { 'content-type': 'application/zip' },
    });
  }));
}

async function importLocalSkill(result: SkillPackageParseResult = PARSED) {
  uploadMutation.mockImplementation((_file: File, options: { onSuccess: (value: SkillPackageParseResult) => void }) => {
    options.onSuccess(result);
  });
  fireEvent.click(screen.getByRole('button', { name: '扫描本地 Skills' }));
  fireEvent.click(screen.getByRole('button', { name: '确认导入选中的 Skill' }));
  await waitFor(() => expect(uploadMutation).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByRole('button', { name: /下一步/ })).not.toBeDisabled());
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

  it('Skill 第二步只显示自动扫描和 CLI 导入，不显示目录选择、ZIP 直传或在线编写', () => {
    renderDialog();
    goToContentStep();

    expect(screen.getByText('扫描并导入本机 Skill')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '扫描本地 Skills' })).toBeInTheDocument();
    expect(screen.queryByText('上传 SKILL 包')).not.toBeInTheDocument();
    expect(screen.queryByText('在线编写')).not.toBeInTheDocument();
    expect(screen.queryByText(/拖入 zip/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /选择.*目录/ })).not.toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).toBeNull();
    expect(screen.getByRole('button', { name: /下一步/ })).toBeDisabled();
  });

  it('扫描并确认 Skill 后上传服务端校验，创建草稿只提交包哈希和文件名', async () => {
    mockBridge();
    renderDialog();
    goToContentStep();
    await importLocalSkill();

    expect(screen.getByRole('button', { name: /下一步/ })).not.toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /下一步/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /创建草稿/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /创建草稿/ }));

    const [body] = createMutation.mock.calls[0] as [Record<string, unknown>];
    expect(body.skillConfig).toEqual({ packageSha256: 'a'.repeat(64), packageFilename: '竞品周报.zip' });
    expect(JSON.stringify(body)).not.toContain('你是竞品分析助手');
    expect(JSON.stringify(body)).not.toContain('template');
  });

  it('RPA 仍保留 ZIP 上传流程，不复用 Skill 本地扫描入口', async () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /^RPA/ }));
    goToContentStep();

    expect(screen.getByText('上传可复用的自动化流程')).toBeInTheDocument();
    expect(screen.getByText('点击选择 RPA ZIP 包')).toBeInTheDocument();
    expect(screen.queryByText('扫描并导入本机 Skill')).not.toBeInTheDocument();
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

    const [body] = createMutation.mock.calls[0] as [{ rpaConfig: Record<string, unknown> }];
    expect(body.rpaConfig).toMatchObject({ packageSha256: 'c'.repeat(64), packageFilename: 'invoice-rpa.zip' });
  });
});
