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
    apiMocks.batchUpdateAvatarStyle.mockResolvedValue({ success: true, updated: 1, style: 'platform', appliedToAll: false });
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

  it('确认默认切换前默认只影响 followers，并在确认后发送 styleId', async () => {
    renderPage();
    await waitForPage();

    fireEvent.click(within(screen.getByRole('article', { name: '卡通风格' })).getByRole('button', { name: '设为平台默认' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('默认更新 1 位跟随默认的员工。1 位单独设置的员工会保持原设置');
    expect(apiMocks.batchUpdateAvatarStyle).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: '确认切换' }));
    await waitFor(() => expect(apiMocks.batchUpdateAvatarStyle).toHaveBeenCalledWith('dicebear', false));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('勾选同步全部员工后发送覆盖参数', async () => {
    renderPage();
    await waitForPage();

    fireEvent.click(within(screen.getByRole('article', { name: '卡通风格' })).getByRole('button', { name: '设为平台默认' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '同步全部员工' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '确认切换' }));

    await waitFor(() => expect(apiMocks.batchUpdateAvatarStyle).toHaveBeenCalledWith('dicebear', true));
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


const CHARACTER_STYLES = [
  { ...DICEBEAR_STYLE, id: 'cartoon:toon-head', name: 'Toon Head', source: 'dicebear', delivery: 'generated' as const },
  { ...DICEBEAR_STYLE, id: 'open-peeps-busts', name: 'Open Peeps 半身人物', source: 'open-peeps', delivery: 'static' as const, totalAssets: 49 },
];

describe('新增数字员工素材来源', () => {
  const attribution = 'Robots lovingly delivered by Robohash.org. Robot artwork by Zikri Kader (set1) and Julian Peter Arias (set3).';
  const styles = [
    { ...DICEBEAR_STYLE, id: 'beanheads-professional', name: 'Bean Heads 职业人物', source: 'beanheads', delivery: 'generated' as const },
    ...['set1', 'set3'].map((pack) => ({
      ...DICEBEAR_STYLE, id: `robohash-${pack}`, name: `RoboHash ${pack}`, source: 'robohash', delivery: 'static' as const,
      totalAssets: 32, license: { name: 'CC BY 3.0', url: 'https://creativecommons.org/licenses/by/3.0/', attribution, requiresAttribution: true },
    })),
  ];
  beforeEach(() => {
    vi.clearAllMocks();
    const data = response();
    apiMocks.getAvatarStyles.mockResolvedValue(response({
      styles: [PLATFORM_STYLE, ...styles], total: 4,
      employees: data.employees.map((employee) => ({ ...employee, availableStyleIds: [...employee.availableStyleIds, ...styles.map((style) => style.id)] })),
    }));
    apiMocks.updateEmployeeAvatarStyle.mockResolvedValue({});
  });
  it('两个来源独立筛选，机器人署名和素材数直接可见', async () => {
    renderPage();
    await waitForPage();
    fireEvent.change(screen.getByLabelText('筛选风格来源'), { target: { value: 'beanheads' } });
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByRole('article', { name: 'Bean Heads 职业人物' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('筛选风格来源'), { target: { value: 'robohash' } });
    expect(screen.getAllByRole('article')).toHaveLength(2);
    for (const article of screen.getAllByRole('article')) {
      expect(within(article).getByText(attribution)).toBeVisible();
      expect(within(article).getByText('RoboHash · 32 个形象')).toBeInTheDocument();
    }
  });
  it.each(styles.map((style) => [style.id]))('员工可单独选择 %s', async (id) => {
    renderPage();
    await waitForPage();
    const select = screen.getByLabelText('固定员工的头像风格');
    expect(select.querySelector('optgroup[label="Bean Heads"]')).toBeInTheDocument();
    expect(select.querySelector('optgroup[label="RoboHash"]')).toBeInTheDocument();
    fireEvent.change(select, { target: { value: id } });
    fireEvent.click(screen.getByRole('button', { name: '保存固定员工的头像设置' }));
    await waitFor(() => expect(apiMocks.updateEmployeeAvatarStyle).toHaveBeenCalledWith('employee-fixed', id));
  });
});

describe('人物头像来源分类', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getAvatarStyles.mockResolvedValue(response({ styles: [PLATFORM_STYLE, DICEBEAR_STYLE, ...CHARACTER_STYLES] }));
  });

  it('人物来源按来源分组，没有已移除的图案和姓名头像来源', async () => {
    renderPage();
    await waitForPage();
    for (const [name, count] of [['平台素材', 1], ['DiceBear', 2], ['Open Peeps 原版', 1]]) {
      expect(screen.getByRole('region', { name: `${name}风格` })).toBeInTheDocument();
      expect(within(screen.getByLabelText('筛选风格来源')).getByRole('option', { name: `${name}（${count}）` })).toBeInTheDocument();
    }
    expect(screen.getAllByRole('article')).toHaveLength(4);
    expect(screen.queryByRole('region', { name: 'Boring Avatars风格' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'UI Avatars风格' })).not.toBeInTheDocument();
  });

  it('筛选 Open Peeps 仅显示原版人物', async () => {
    renderPage();
    await waitForPage();
    fireEvent.change(screen.getByLabelText('筛选风格来源'), { target: { value: 'open-peeps' } });
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByRole('article', { name: 'Open Peeps 半身人物' })).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'Toon Head' })).not.toBeInTheDocument();
  });

  it('风格搜索和来源筛选组合生效，空结果可清除且不影响员工搜索', async () => {
    renderPage();
    await waitForPage();
    fireEvent.change(screen.getByLabelText('搜索头像风格'), { target: { value: 'Toon Head' } });
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByText('固定员工')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('筛选风格来源'), { target: { value: 'open-peeps' } });
    expect(screen.queryAllByRole('article')).toHaveLength(0);
    expect(screen.getByText('没有匹配的头像风格，请调整搜索或来源筛选。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }));
    expect(screen.getAllByRole('article')).toHaveLength(4);
    expect(screen.getByLabelText('搜索头像风格')).toHaveValue('');
  });

  it('员工人物风格按来源分组，原版静态人物可绑定覆盖', async () => {
    renderPage();
    await waitForPage();
    const employeeSelect = screen.getByLabelText('固定员工的头像风格');
    expect(employeeSelect.querySelector('optgroup[label="DiceBear"]')).toBeInTheDocument();
    expect(employeeSelect.querySelector('optgroup[label="Open Peeps 原版"]')).toBeInTheDocument();
    expect(employeeSelect.querySelector('optgroup[label="Boring Avatars"]')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '绑定员工素材' }));
    const select = within(await screen.findByRole('dialog')).getByRole('combobox', { name: '素材风格' });
    expect(within(select).getByRole('option', { name: 'Open Peeps 半身人物' })).toBeInTheDocument();
    expect(within(select).queryByRole('option', { name: 'Toon Head' })).not.toBeInTheDocument();
  });

  it('已停用的当前风格保留显示，可改选人物头像', async () => {
    const data = response({ styles: [PLATFORM_STYLE, ...CHARACTER_STYLES] });
    data.employees[0].avatarStyle = 'cartoon:glass';
    data.employees[0].effectiveStyleId = 'cartoon:glass';
    apiMocks.getAvatarStyles.mockResolvedValue(data);
    renderPage();
    await waitForPage();
    const select = screen.getByLabelText('跟随员工的头像风格');
    expect(select).toHaveValue('cartoon:glass');
    expect(within(select).getByRole('option', {name: '原风格（已停用）'})).toBeDisabled();
  });

  it('按风格显示授权信息和署名要求', async () => {
    apiMocks.getAvatarStyles.mockResolvedValue(response({ styles: [PLATFORM_STYLE, {
      ...DICEBEAR_STYLE, license: { name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/', attribution: 'Author credit', requiresAttribution: true },
    }] }));
    renderPage();
    await waitForPage();
    const article = screen.getByRole('article', { name: '卡通风格' });
    expect(within(article).getByRole('link', { name: 'CC BY 4.0' })).toHaveAttribute('title', 'Author credit');
    expect(within(article).getByText(/需保留署名/)).toBeInTheDocument();
  });
});
