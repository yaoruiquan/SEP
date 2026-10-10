import { describe, expect, it, vi, beforeAll, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ContributionDetail } from './contribution-detail';
import type { ContributionCapabilityDetail } from '@/lib/types';

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

const submitVersion = vi.fn();

const { downloadFile } = vi.hoisted(() => ({ downloadFile: vi.fn() }));
downloadFile.mockResolvedValue({ filename: '周报.zip', sha256: 'a'.repeat(64) });
vi.mock('@/lib/api-client', () => ({ downloadFile }));
/** 预览弹窗替换成探针：只关心贡献中心传了哪条授权来源。 */
const previewProps: Array<{ source?: string; versionId: string }> = [];

vi.mock('@/features/skill-version/SkillVersionPreviewDialog', () => ({
  SkillVersionPreviewDialog: (props: { source?: string; versionId: string }) => {
    previewProps.push(props);
    return null;
  },
}));

vi.mock('./use-contributions', () => ({
  useContribution: () => ({ isLoading: false, isError: false, data: detail }),
  useContributionUsage: () => ({ isLoading: false, isError: false, data: undefined }),
  useContributionAction: () => ({ mutate: vi.fn(), isPending: false }),
  useReviewContribution: () => ({ mutate: vi.fn(), isPending: false }),
  useSubmitVersion: () => ({ mutate: submitVersion, isPending: false }),
  useVersionDiff: (versionId: string) => ({
    isLoading: false,
    isError: false,
    data: versionId ? {
      version: { id: versionId, capabilityId: 'cap-1', capabilityName: '竞品周报生成器', scope: 'ENTERPRISE', enterpriseId: 'e1', parentVersionId: 'parent-1', sourceVersionId: null, version: '1.0.0', changeSummary: '补充边界条件', status: 'ENTERPRISE_REJECTED', rejectionReason: '缺少异常数据处理', submittedAt: null, createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-02T00:00:00.000Z' },
      parent: { id: 'parent-1', version: '0.9.0', content: '# 角色\n旧版' },
      current: { id: versionId, version: '1.0.0', content: '# 角色\n新版' },
      changed: true,
      reviews: [{ id: 'review-1', actorType: 'ENTERPRISE', decision: 'REJECT', reviewerId: 'admin-1', comment: '缺少异常数据处理', createdAt: '2026-08-02T00:00:00.000Z', reviewer: { id: 'admin-1', name: '管理员', email: 'admin@example.com' } }],
    } : undefined,
  }),
  // VersionPublishDialog 也从这个模块取 hook
  useCreateVersion: () => ({ mutate: vi.fn(), isPending: false }),
  useUploadSkillPackage: () => ({ mutate: vi.fn(), isPending: false }),
  // VersionEditDialog 的作者端点
  useAuthorVersion: () => ({ isLoading: false, isError: false, data: undefined }),
  useUpdateVersion: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/lib/auth-store', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({
      enterprise: { id: 'e1', name: '示例企业' },
      roleInEnterprise: 'MEMBER',
      user: { id: 'author-1' },
    }),
}));

function version(overrides: Partial<ContributionCapabilityDetail['skillVersions'][number]>) {
  return {
    id: 'v1',
    scope: 'ENTERPRISE' as const,
    enterpriseId: 'e1',
    parentVersionId: null,
    sourceVersionId: null,
    version: '1.0.0',
    changeSummary: '初始版本',
    status: 'DRAFT' as const,
    packageKey: null,
    packageSha256: null,
    packageFileCount: null,
    packageFilename: null,
    rejectionReason: null,
    createdById: 'author-1',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

let detail: ContributionCapabilityDetail;

function baseDetail(
  versions: ContributionCapabilityDetail['skillVersions'],
  overrides: Partial<ContributionCapabilityDetail> = {},
): ContributionCapabilityDetail {
  return {
    id: 'cap-1',
    name: '竞品周报生成器',
    description: '每周汇总竞品动态',
    type: 'SKILL',
    industry: [],
    position: [],
    status: 'PENDING',
    enterpriseId: 'e1',
    visibility: 'ENTERPRISE_PRIVATE',
    enterpriseReviewStatus: 'NOT_SUBMITTED',
    enterpriseReviewedById: null,
    enterpriseReviewedAt: null,
    enterpriseRejectionReason: null,
    platformReviewStatus: 'NOT_SUBMITTED',
    platformSubmittedById: null,
    platformSubmittedAt: null,
    platformRejectionReason: null,
    usageCount: 0,
    rating: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    contributor: { id: 'author-1', name: '作者', email: 'a@example.com' },
    enterprise: { id: 'e1', name: '示例企业' },
    skillConfig: null,
    agentConfig: null,
    _count: { skillVersions: versions.length, bindings: 0 },
    inputSchema: {},
    outputSchema: {},
    skillVersions: versions,
    contributionRewards: [],
    ...overrides,
  } as ContributionCapabilityDetail;
}

function renderVersions() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ContributionDetail id="cap-1" onBack={vi.fn()} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: '版本迭代' }));
}

describe('版本迭代', () => {
  beforeEach(() => {
    submitVersion.mockReset();
    downloadFile.mockClear();
    previewProps.length = 0;
    detail = baseDetail([version({})]);
  });

  it('预览走作者授权来源，不走企业订阅那条', () => {
    renderVersions();
    fireEvent.click(screen.getByRole('button', { name: /预览/ }));
    // 企业侧 preview 要求成员持有该能力的订阅授权，贡献场景永远拿不到
    expect(previewProps.at(-1)?.source).toBe('author');
  });

  it('作者不能从 Web 发布新版本', () => {
    renderVersions();
    expect(screen.queryByRole('button', { name: /发布新版本/ })).not.toBeInTheDocument();
  });

  it('上传来的版本给下载包、不给行内编辑', () => {
    detail = baseDetail([
      version({ packageKey: 'skills/aa.zip', packageFilename: '周报.zip', packageFileCount: 3 }),
    ]);
    renderVersions();

    fireEvent.click(screen.getByRole('button', { name: /下载包/ }));
    expect(downloadFile).toHaveBeenCalledWith('/contributions/versions/v1/package');
    // 正文来源是包，改文字没有意义 —— 要改就发新版本
    expect(screen.queryByRole('button', { name: /编辑/ })).not.toBeInTheDocument();
    expect(screen.getByText('SKILL 包')).toBeInTheDocument();
    expect(screen.getByText(/周报\.zip/)).toBeInTheDocument();
  });

  it('没有 SKILL 上传、正文编辑或提交入口', () => {
    renderVersions();
    expect(screen.queryByRole('button', { name: /编辑|提交审核|发布新版本/ })).not.toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).not.toBeInTheDocument();
    expect(submitVersion).not.toHaveBeenCalled();
  });

  it('平台驳回历史仍显示原因，但不能 Web 返工或投稿', () => {
    detail = baseDetail([
      version({ status: 'PLATFORM_REJECTED', rejectionReason: '缺少边界条件' }),
    ]);
    renderVersions();

    expect(screen.getByText(/驳回原因：缺少边界条件/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /提交审核|编辑|发布新版本/ })).not.toBeInTheDocument();
    expect(submitVersion).not.toHaveBeenCalled();
  });

  it('审核中的版本不给提交按钮', () => {
    detail = baseDetail([version({ status: 'PENDING_ENTERPRISE_REVIEW' })]);
    renderVersions();
    expect(screen.queryByRole('button', { name: /提交审核/ })).not.toBeInTheDocument();
  });

  it('已公开的历史版本也不能从 Web 继续迭代', () => {
    detail = baseDetail([version({ status: 'PLATFORM_APPROVED' })], {
      visibility: 'MARKET_PUBLIC',
    });
    renderVersions();
    expect(screen.queryByRole('button', { name: /发布新版本|编辑|提交审核/ })).not.toBeInTheDocument();
    expect(screen.getByText(/客户端维护/)).toBeInTheDocument();
  });

  it('企业驳回记录保留差异与审核历史', () => {
    detail = baseDetail([version({ status: 'ENTERPRISE_REJECTED', parentVersionId: 'parent-1', rejectionReason: '缺少异常数据处理' })]);
    renderVersions();
    fireEvent.click(screen.getByRole('button', { name: /查看变更/ }));
    expect(screen.getAllByText(/缺少异常数据处理/).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /提交审核|编辑/ })).not.toBeInTheDocument();
  });
});
