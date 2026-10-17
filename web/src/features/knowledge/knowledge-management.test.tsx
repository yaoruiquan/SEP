import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, uploadForm } from '@/lib/api-client';
import { useAuthStore } from '@/lib/auth-store';
import type { KnowledgeLimits } from '@/lib/types';
import KnowledgePage from '@/app/(enterprise)/knowledge/page';
import { DocumentUploader } from './document-uploader';
import { DocumentPreview } from './document-preview';
import { KnowledgeGrantsPanel } from './knowledge-grants-panel';
import { KnowledgeSearchPanel } from './knowledge-search-panel';

vi.mock('@/lib/api-client', async (original) => ({
  ...await original<typeof import('@/lib/api-client')>(),
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn(), patch: vi.fn() }, uploadForm: vi.fn(),
}));

const limits: KnowledgeLimits = { allowedExtensions: ['.txt'], maxFileBytes: 1024, maxFilesPerRequest: 2, maxQueryCharacters: 1000, maxSearchKnowledgeBases: 100, maxTopK: 20, maxResultTokens: 6000 };
const context = { items: [], page: 1, pageSize: 20, total: 0, viewer: { role: 'ADMIN' }, capabilities: { canCreateKnowledgeBase: true, canListGrantCandidates: true }, limits };
const clients: QueryClient[] = [];
function view(element: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(client);
  return render(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
}

beforeEach(() => {
  useAuthStore.setState({ enterprise: { id: 'enterprise', name: '企业' }, roleInEnterprise: 'ENTERPRISE_ADMIN', user: { id: 'user', name: '管理员', email: 'admin@example.com', avatar: null, role: 'USER' } });
  vi.mocked(api.get).mockResolvedValue(context);
});
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); useAuthStore.getState().clear(); vi.resetAllMocks(); });

describe('knowledge management access and errors', () => {
  it('does not grant a global platform admin access to enterprise management data', () => {
    useAuthStore.setState({ roleInEnterprise: 'MEMBER', user: { id: 'user', name: null, email: 'ops@example.com', avatar: null, role: 'ADMIN' } });
    view(<KnowledgePage />);
    expect(screen.getByText('仅企业管理员可管理知识库')).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('honors the backend viewer over a stale local admin role', async () => {
    vi.mocked(api.get).mockResolvedValue({ ...context, viewer: { role: 'EMPLOYEE' } });
    view(<KnowledgePage />);
    expect(await screen.findByText('仅企业管理员可管理知识库')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '新建知识库' })).not.toBeInTheDocument();
  });

  it('renders server-granted create capability for an empty list', async () => {
    view(<KnowledgePage />);
    expect(await screen.findByRole('heading', { name: '企业知识库' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新建知识库' })).toBeInTheDocument();
    expect(screen.getByText('暂无知识库，创建后即可上传企业资料。')).toBeInTheDocument();
  });

  it('shows permission failures rather than an empty library list', async () => {
    vi.mocked(api.get).mockRejectedValue(new ApiError(403, 'forbidden'));
    view(<KnowledgePage />);
    expect(await screen.findByText('没有知识库管理权限，或企业成员身份已失效。')).toBeInTheDocument();
    expect(screen.queryByText('暂无知识库，创建后即可上传企业资料。')).not.toBeInTheDocument();
  });

  it('keeps paginated library search on the server and hides forbidden actions', async () => {
    vi.mocked(api.get).mockResolvedValue({ ...context, total: 21, items: [{ id: 'kb', name: '公司制度', description: '', documentCount: 3, readyDocumentCount: 2, updatedAt: '2026-10-16', permissions: { canManage: false } }] });
    view(<KnowledgePage />);
    expect(await screen.findByRole('link', { name: '公司制度' })).toHaveAttribute('href', '/knowledge/kb');
    expect(screen.queryByRole('button', { name: '编辑 公司制度' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/knowledge-bases?page=2&pageSize=20'));
    fireEvent.change(screen.getByRole('textbox', { name: '搜索知识库' }), { target: { value: '制度' } });
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/knowledge-bases?page=1&pageSize=20&keyword=%E5%88%B6%E5%BA%A6'));
  });
});

describe('upload queue', () => {
  it('uploads each selected file once, preserves every completion and uses no fake percentage', async () => {
    let resolveFirst: (value: unknown) => void = () => {};
    vi.mocked(uploadForm).mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; })).mockResolvedValue({});
    const complete = vi.fn();
    view(<DocumentUploader knowledgeBaseId="kb" limits={limits} onUploadComplete={complete} />);
    fireEvent.change(screen.getByLabelText('选择上传文件'), { target: { files: [new File(['first'], 'first.txt'), new File(['second'], 'second.txt')] } });
    fireEvent.click(screen.getByRole('button', { name: '开始上传' }));
    fireEvent.click(screen.getByRole('button', { name: '上传中…' }));
    expect(screen.queryByText(/\d+%/)).not.toBeInTheDocument();
    await waitFor(() => expect(uploadForm).toHaveBeenCalledTimes(1));
    await act(async () => { resolveFirst({}); });
    await waitFor(() => expect(screen.getAllByText('已上传，等待后台处理')).toHaveLength(2));
    expect(uploadForm).toHaveBeenCalledTimes(2);
    expect(complete).toHaveBeenCalledTimes(1);
    const bodies = vi.mocked(uploadForm).mock.calls.map((call) => call[1] as FormData);
    expect((bodies[0].get('file') as File).name).toBe('first.txt');
    expect((bodies[1].get('file') as File).name).toBe('second.txt');
  });

  it('uses actual server file limits and reports invalid files without sending them', () => {
    view(<DocumentUploader knowledgeBaseId="kb" limits={{ ...limits, maxFileBytes: 3 }} />);
    fireEvent.change(screen.getByLabelText('选择上传文件'), { target: { files: [new File(['abcd'], 'large.txt'), new File(['x'], 'other.pdf')] } });
    expect(screen.getByText(/文件超过大小限制/)).toBeInTheDocument();
    expect(screen.getByText('文件格式不支持')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '开始上传' })).not.toBeInTheDocument();
    expect(uploadForm).not.toHaveBeenCalled();
  });
});

describe('members, search and read-only previews', () => {
  it('returns to the previous page after revoking the last grant on the final page', async () => {
    let revoked = false;
    vi.mocked(api.get).mockImplementation(async (path) => {
      const page = path.includes('page=2') ? 2 : 1;
      const items = page === 2 && revoked ? [] : [{
        id: `grant-${page}`, member: { memberId: `member-${page}`, name: page === 2 ? '李四' : '张三', avatarUrl: null, position: null, departmentName: null },
        grantedAt: '2026-10-16', grantedBy: { memberId: 'admin', name: '管理员' },
      }];
      return { items, page, pageSize: 20, total: revoked ? 20 : 21 };
    });
    vi.mocked(api.delete).mockImplementation(async () => { revoked = true; });
    view(<KnowledgeGrantsPanel knowledgeBaseId="kb" />);
    expect(await screen.findByText('张三')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    fireEvent.click(await screen.findByRole('button', { name: '撤销 李四 的权限' }));
    fireEvent.click(screen.getByRole('button', { name: '确认撤销' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/knowledge-bases/kb/grants/member-2'));
    expect(await screen.findByText('张三')).toBeInTheDocument();
    expect(screen.getByText('1 / 1')).toBeInTheDocument();
  });

  it('preserves cross-page member selection and a failed batch submission for retry', async () => {
    vi.mocked(api.get).mockImplementation(async (path) => path.includes('view=knowledge-grant') ? {
      items: [{ memberId: path.includes('page=2') ? 'member-2' : 'member-1', name: path.includes('page=2') ? '李四' : '张三', avatarUrl: null, position: '销售', departmentName: '业务部' }], page: path.includes('page=2') ? 2 : 1, pageSize: 20, total: 21,
    } : { items: [], page: 1, pageSize: 20, total: 0 });
    vi.mocked(api.post).mockRejectedValueOnce(new ApiError(400, '成员已离职，请重新选择'));
    view(<KnowledgeGrantsPanel knowledgeBaseId="kb" />);
    fireEvent.click(screen.getByRole('button', { name: '添加成员' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: '选择 张三' }));
    fireEvent.click(screen.getAllByRole('button', { name: '下一页' }).find((button) => !button.hasAttribute('disabled'))!);
    fireEvent.click(await screen.findByRole('checkbox', { name: '选择 李四' }));
    fireEvent.click(screen.getByRole('button', { name: '确认授权' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('成员已离职，请重新选择');
    expect(api.post).toHaveBeenCalledWith('/knowledge-bases/kb/grants', { memberIds: ['member-1', 'member-2'] });
    expect(screen.getByText('已选 2 人，最多 100 人')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '选择 李四' })).toBeChecked();
  });

  it('sends only a query, displays content and source without exposing score controls', async () => {
    vi.mocked(api.post).mockResolvedValue({ results: [{ chunkId: 'chunk', content: '报销须在月底前完成。', source: '报销制度.pdf', documentId: 'doc' }] });
    view(<KnowledgeSearchPanel knowledgeBaseId="kb" maxQueryCharacters={1000} />);
    fireEvent.change(screen.getByRole('textbox', { name: '检索问题' }), { target: { value: ' 报销时间 ' } });
    fireEvent.click(screen.getByRole('button', { name: '验证检索' }));
    expect(await screen.findByText('报销须在月底前完成。')).toBeInTheDocument();
    expect(screen.getByText('来源：报销制度.pdf')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看文档正文' })).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/knowledge-bases/kb/test-search', { query: '报销时间' });
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  });

  it('renders processed chunks as plain read-only content and keeps 409 visible', async () => {
    vi.mocked(api.get).mockResolvedValue({ documentId: 'doc', documentName: '制度', previewKind: 'PROCESSED_CHUNKS', items: [{ chunkId: 'chunk', text: '<script>正文</script>' }], page: 1, pageSize: 20, total: 1 });
    const { unmount } = view(<DocumentPreview knowledgeBaseId="kb" documentId="doc" onClose={vi.fn()} />);
    expect(await screen.findByText('<script>正文</script>')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(document.querySelector('script')).toBeNull();
    unmount();
    vi.mocked(api.get).mockRejectedValue(new ApiError(409, '文档尚未处理完成'));
    view(<DocumentPreview knowledgeBaseId="kb" documentId="pending" onClose={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('生效版本已变更');
    expect(screen.getByRole('button', { name: '刷新文档列表' })).toBeInTheDocument();
    expect(screen.queryByText('暂无可预览的正文。')).not.toBeInTheDocument();
  });
});
