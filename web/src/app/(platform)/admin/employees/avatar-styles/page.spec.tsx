import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AvatarStylesResponse } from '@/features/admin/admin-api';
import AvatarStylesPage from './page';

const apiMocks = vi.hoisted(() => ({
  getAvatarStyles: vi.fn(),
  batchUpdateAvatarStyle: vi.fn(),
  updateEmployeeAvatarStyle: vi.fn(),
  registerAvatarStyle: vi.fn(),
  bindEmployeeAvatar: vi.fn(),
}));

vi.mock('@/features/admin/admin-api', () => ({ adminApi: apiMocks }));

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

const PLATFORM_STYLE = {
  id: 'platform',
  name: '平台风格',
  description: '平台统一素材',
  category: 'professional',
  recommended: true,
  source: 'platform',
  examples: [],
  coverage: { matched: 2, total: 2 },
  canSetDefault: true,
};

const DICEBEAR_STYLE = {
  id: 'dicebear',
  name: '卡通风格',
  description: '卡通头像库',
  category: 'cartoon',
  recommended: false,
  source: 'dicebear',
  examples: [],
  coverage: { matched: 1, total: 2 },
  canSetDefault: true,
};

const INCOMPLETE_STYLE = {
  id: 'incomplete',
  name: '未完成风格',
  description: '覆盖不完整，不能设为默认',
  category: 'other',
  recommended: false,
  source: 'platform',
  examples: [],
  coverage: { matched: 1, total: 2 },
  canSetDefault: false,
};

function response(overrides: Partial<AvatarStylesResponse> = {}): AvatarStylesResponse {
  return {
    styles: [PLATFORM_STYLE, DICEBEAR_STYLE, INCOMPLETE_STYLE],
    total: 3,
    defaultStyleId: 'platform',
    followersCount: 1,
    overridesCount: 1,
    employees: [
      {
        id: 'employee-following',
        name: '跟随员工',
        position: '产品经理',
        avatar: null,
        avatarStyle: 'follow-default',
        effectiveStyleId: 'platform',
        availableStyleIds: ['follow-default', 'platform'],
      },
      {
        id: 'employee-fixed',
        name: '固定员工',
        position: '工程师',
        avatar: null,
        avatarStyle: 'platform',
        effectiveStyleId: 'platform',
        availableStyleIds: ['follow-default', 'platform'],
      },
      {
        id: 'employee-cartoon',
        name: '卡通员工',
        position: '设计师',
        avatar: null,
        avatarStyle: 'follow-default',
        effectiveStyleId: 'platform',
        availableStyleIds: ['follow-default'],
      },
    ],
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AvatarStylesPage />
    </QueryClientProvider>,
  );
}

async function waitForPage() {
  await screen.findByRole('article', { name: '平台风格' });
}

describe('AvatarStylesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getAvatarStyles.mockResolvedValue(response());
    apiMocks.batchUpdateAvatarStyle.mockResolvedValue({ success: true, updated: 1, style: 'platform' });
    apiMocks.updateEmployeeAvatarStyle.mockResolvedValue({});
    apiMocks.registerAvatarStyle.mockResolvedValue(PLATFORM_STYLE);
    apiMocks.bindEmployeeAvatar.mockResolvedValue({});
  });

  it('禁用当前默认和覆盖不完整风格的默认切换', async () => {
    renderPage();
    await waitForPage();

    expect(within(screen.getByRole('article', { name: '平台风格' })).getByRole('button', { name: '正在使用' })).toBeDisabled();
    expect(within(screen.getByRole('article', { name: '未完成风格' })).getByRole('button', { name: '设为平台默认' })).toBeDisabled();
    expect(screen.getAllByText('尚未覆盖全部员工，可在下方为已匹配的员工单独使用。')).toHaveLength(1);
  });

  it('确认默认切换前提示只影响 followers，并在确认后发送 styleId', async () => {
    renderPage();
    await waitForPage();

    fireEvent.click(within(screen.getByRole('article', { name: '卡通风格' })).getByRole('button', { name: '设为平台默认' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('将更新 1 位跟随默认的员工。1 位单独设置的员工保持原设置。');
    expect(apiMocks.batchUpdateAvatarStyle).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: '确认切换' }));
    await waitFor(() => expect(apiMocks.batchUpdateAvatarStyle).toHaveBeenCalledWith('dicebear'));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('默认切换失败时保留弹窗并允许重试', async () => {
    apiMocks.batchUpdateAvatarStyle
      .mockRejectedValueOnce(new Error('网络错误'))
      .mockResolvedValueOnce({ success: true, updated: 1, style: 'dicebear' });

    renderPage();
    await waitForPage();
    fireEvent.click(within(screen.getByRole('article', { name: '卡通风格' })).getByRole('button', { name: '设为平台默认' }));

    let dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '确认切换' }));
    await waitFor(() => expect(within(screen.getByRole('alertdialog')).getByRole('alert')).toHaveTextContent('网络错误'));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    dialog = screen.getByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '确认切换' }));
    await waitFor(() => expect(apiMocks.batchUpdateAvatarStyle).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('员工固定风格和 follow-default 分别发送对应参数', async () => {
    renderPage();
    await waitForPage();

    const fixedSelect = screen.getByLabelText('固定员工的头像风格');
    fireEvent.change(fixedSelect, { target: { value: 'follow-default' } });
    fireEvent.click(screen.getByRole('button', { name: '保存固定员工的头像设置' }));
    await waitFor(() => expect(apiMocks.updateEmployeeAvatarStyle).toHaveBeenCalledWith('employee-fixed', 'follow-default'));

    const followingSelect = screen.getByLabelText('跟随员工的头像风格');
    fireEvent.change(followingSelect, { target: { value: 'platform' } });
    fireEvent.click(screen.getByRole('button', { name: '保存跟随员工的头像设置' }));
    await waitFor(() => expect(apiMocks.updateEmployeeAvatarStyle).toHaveBeenCalledWith('employee-following', 'platform'));
  });

  it('可注册新头像风格，也可绑定员工素材并发送表单参数', async () => {
    renderPage();
    await waitForPage();

    fireEvent.click(screen.getByRole('button', { name: '添加头像风格' }));
    const registerDialog = await screen.findByRole('dialog');
    const registerInputs = within(registerDialog).getAllByRole('textbox');
    fireEvent.change(registerInputs[0], { target: { value: '写实职业形象' } });
    fireEvent.change(registerInputs[1], { target: { value: 'professional-photo' } });
    fireEvent.change(registerInputs[2], { target: { value: '适用于企业员工的写实头像' } });
    fireEvent.click(within(registerDialog).getByRole('button', { name: '保存风格' }));
    await waitFor(() => expect(apiMocks.registerAvatarStyle).toHaveBeenCalledWith({
      id: 'professional-photo',
      name: '写实职业形象',
      description: '适用于企业员工的写实头像',
      category: '自有素材',
    }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '绑定员工素材' }));
    const bindDialog = await screen.findByRole('dialog');
    fireEvent.change(within(bindDialog).getByRole('combobox', { name: '员工' }), { target: { value: 'employee-fixed' } });
    fireEvent.change(within(bindDialog).getByRole('combobox', { name: '素材风格' }), { target: { value: 'platform' } });
    const bindInputs = within(bindDialog).getAllByRole('textbox');
    fireEvent.change(bindInputs[0], { target: { value: '/assets/fixed.png' } });
    fireEvent.change(bindInputs[1], { target: { value: '/assets/fixed-face.png' } });
    fireEvent.change(bindInputs[2], { target: { value: '2026-09-v1' } });
    fireEvent.click(within(bindDialog).getByRole('button', { name: '保存绑定' }));
    await waitFor(() => expect(apiMocks.bindEmployeeAvatar).toHaveBeenCalledWith('employee-fixed', {
      styleId: 'platform',
      portraitUrl: '/assets/fixed.png',
      faceUrl: '/assets/fixed-face.png',
      version: '2026-09-v1',
    }));
  });

  it('员工选择会按姓名或岗位过滤，风格来源筛选也会生效', async () => {
    renderPage();
    await waitForPage();

    fireEvent.change(screen.getByLabelText('搜索员工'), { target: { value: '工程师' } });
    expect(screen.getByText('固定员工')).toBeInTheDocument();
    expect(screen.queryByText('跟随员工')).not.toBeInTheDocument();
    expect(screen.queryByText('卡通员工')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('筛选风格来源'), { target: { value: 'dicebear' } });
    expect(screen.getByRole('article', { name: '卡通风格' })).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: '平台风格' })).not.toBeInTheDocument();
    expect(screen.queryByRole('article', { name: '未完成风格' })).not.toBeInTheDocument();
  });
});
