import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '@/lib/auth-store';
import { SkillForm } from './skill-form';

const { push, success, error } = vi.hoisted(() => ({ push: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/components/ui/toast', () => ({ toast: { success, error } }));
const metadata = { zipPath: 'skills/abc.zip', sha256: 'a'.repeat(64), fileCount: 4, totalSize: 8192, filename: '测试.ZIP', content: '---\nname: complete\n---\n# 完整 SKILL.md 正文' };
const fetchMock = vi.fn();
function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }); }
function mount() {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}><SkillForm onCancel={vi.fn()} /></QueryClientProvider>);
}
async function upload() {
  fireEvent.change(screen.getByLabelText('Zip 文件（必须包含 SKILL.md）'), { target: { files: [new File(['zip'], metadata.filename, { type: 'application/zip' })] } });
  await screen.findByText(`文件: ${metadata.filename}`);
}
function fill() {
  fireEvent.change(screen.getByLabelText('能力名称'), { target: { value: '测试技能' } });
  fireEvent.change(screen.getByLabelText('能力描述'), { target: { value: '完整上传包并保留正文的测试技能说明' } });
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('fetch', fetchMock);
  useAuthStore.getState().setAuth({ token: 'ops-memory-token', user: { id: 'ops', name: '运营', email: 'ops@example.com', avatar: null, role: 'ADMIN' }, enterprise: null, roleInEnterprise: null });
  fetchMock.mockImplementation(async (path: string) => response(path.endsWith('upload-skill') ? metadata : { id: 'created-cap' }));
});
afterEach(() => { useAuthStore.getState().clear(); vi.unstubAllGlobals(); });
describe('ops SKILL 首次创建认证契约', () => {
  it('上传和 generic 创建均带内存 token，完整传包 metadata 和首版正文，进入待审', async () => {
    mount(); fill(); await upload();
    fireEvent.click(screen.getByRole('button', { name: '创建并进入平台待审' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/admin/skills'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [uploadPath, uploadOptions] = fetchMock.mock.calls[0];
    expect(uploadPath).toBe('/api/admin/capabilities/upload-skill');
    expect(uploadOptions).toMatchObject({ method: 'POST', credentials: 'include', headers: { Authorization: 'Bearer ops-memory-token' } });
    expect(uploadOptions.headers['Content-Type']).toBeUndefined();
    expect(uploadOptions.body).toBeInstanceOf(FormData);
    const [createPath, createOptions] = fetchMock.mock.calls[1];
    expect(createPath).toBe('/api/capabilities');
    expect(createOptions).toMatchObject({ method: 'POST', credentials: 'include', headers: { Authorization: 'Bearer ops-memory-token', 'Content-Type': 'application/json' } });
    expect(JSON.parse(createOptions.body)).toMatchObject({ type: 'skill', name: '测试技能', metadata: { zipPath: metadata.zipPath, sha256: metadata.sha256, fileCount: 4, totalSize: 8192, filename: metadata.filename }, skillConfig: { template: metadata.content } });
    expect(success).toHaveBeenCalledWith('创建成功', '技能已进入平台待审，审核通过后才会公开');
    expect(fetchMock.mock.calls.some(([path]) => /approve|review/.test(path))).toBe(false);
  });
  it('上传 403 时不能创建，没有无认证备用请求', async () => {
    fetchMock.mockResolvedValue(response({ message: '仅平台管理员可上传' }, 403));
    mount(); fill();
    fireEvent.change(screen.getByLabelText('Zip 文件（必须包含 SKILL.md）'), { target: { files: [new File(['zip'], 'skill.zip')] } });
    expect(await screen.findByText('仅平台管理员可上传')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '创建并进入平台待审' })).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });
  it('创建 403 保留已上传包并提示，不导航或发布', async () => {
    fetchMock.mockImplementation(async (path: string) => path.endsWith('upload-skill') ? response(metadata) : response({ message: '仅平台管理员可创建 SKILL' }, 403));
    mount(); fill(); await upload();
    fireEvent.click(screen.getByRole('button', { name: '创建并进入平台待审' }));
    await waitFor(() => expect(error).toHaveBeenCalledWith('创建失败', '仅平台管理员可创建 SKILL'));
    expect(screen.getByText(`文件: ${metadata.filename}`)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
