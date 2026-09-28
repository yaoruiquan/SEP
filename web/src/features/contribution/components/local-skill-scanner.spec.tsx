import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LocalSkillScanner } from './local-skill-scanner';

const candidate = {
  id: 'a'.repeat(64),
  name: '竞品周报',
  description: '汇总竞品动态',
  path: '/Users/test/.claude/skills/weekly',
  source: 'claude-code',
  scope: 'user' as const,
  sha256: 'b'.repeat(64),
  fileCount: 2,
  totalBytes: 1024,
  files: ['SKILL.md', 'examples/input.txt'],
};

function mockBridge() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/scan')) {
      return new Response(JSON.stringify({ scannerVersion: '0.2.0', items: [candidate] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('zip bytes', {
      status: 200,
      headers: { 'content-type': 'application/zip' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}


beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LocalSkillScanner', () => {
  it('只通过本地 CLI bridge 扫描并展示 Skill，不渲染浏览器目录选择器', async () => {
    const fetchMock = mockBridge();
    render(<LocalSkillScanner onPackaged={vi.fn()} />);

    expect(document.querySelector('input[type="file"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '扫描本地 Skills' }));

    expect(await screen.findByText('竞品周报')).toBeInTheDocument();
    expect(screen.getByText('汇总竞品动态')).toBeInTheDocument();
    expect(screen.getByText(/claude-code · user/)).toBeInTheDocument();
    expect(screen.getByLabelText('本地 Skill 扫描结果')).toHaveTextContent(candidate.path);
    expect(screen.getByText(/扫描器 v0.2.0/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/scan?scope=all'), expect.objectContaining({ cache: 'no-store' }));
  });

  it('用户确认选中的 Skill 后由 bridge 打包并回调 File', async () => {
    mockBridge();
    const onPackaged = vi.fn();
    render(<LocalSkillScanner onPackaged={onPackaged} />);

    fireEvent.click(screen.getByRole('button', { name: '扫描本地 Skills' }));
    await screen.findByText('竞品周报');
    fireEvent.click(screen.getByRole('button', { name: '确认导入选中的 Skill' }));

    await waitFor(() => expect(onPackaged).toHaveBeenCalledTimes(1));
    const [file] = onPackaged.mock.calls[0] as [File];
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe('竞品周报.zip');
    expect(file.type).toBe('application/zip');
    expect(await file.text()).toBe('zip bytes');
  });

  it('bridge 未启动时提示运行本地 CLI，而不是退回目录上传', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));
    render(<LocalSkillScanner onPackaged={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '扫描本地 Skills' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      '请先运行：node scripts/skill-scanner/sep-skill.mjs serve',
    );
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });
});
