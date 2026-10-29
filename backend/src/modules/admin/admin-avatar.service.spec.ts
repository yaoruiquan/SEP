import { BadRequestException } from '@nestjs/common';
import { AdminService } from './admin.service';

const siliconAvatar = '/assets/employees/silicon/a11y-tester.webp';

function employee(overrides: Record<string, unknown> = {}) {
  return {
    id: 'employee-1',
    name: '测试员工',
    position: '测试工程师',
    avatar: siliconAvatar,
    avatarStyle: 'follow-default',
    avatarCustomUrl: null,
    avatarBindings: {},
    createdAt: new Date('2026-09-17T00:00:00.000Z'),
    updatedAt: new Date('2026-09-17T00:00:00.000Z'),
    ...overrides,
  } as any;
}

function createHarness(initialEmployees: any[], definitions: any[] = []) {
  const rows = initialEmployees.map((item) => ({ ...item }));
  const digitalEmployee = {
    findMany: jest.fn(async () => rows.map((item) => ({ ...item }))),
    findUnique: jest.fn(async ({ where }: any) => {
      const found = rows.find((item) => item.id === where.id);
      return found ? { ...found } : null;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const index = rows.findIndex((item) => item.id === where.id);
      rows[index] = { ...rows[index], ...data };
      return { ...rows[index] };
    }),
  };
  const systemSetting = {
    findUnique: jest.fn(async () => ({ key: 'DEFAULT_AVATAR_STYLE', value: 'silicon-3d' })),
    upsert: jest.fn(async ({ create, update }: any) => ({ ...create, ...update })),
  };
  const avatarStyleDefinition = {
    findMany: jest.fn(async () => definitions),
    findUnique: jest.fn(),
    create: jest.fn(),
  };
  const prisma: any = {
    digitalEmployee,
    systemSetting,
    avatarStyleDefinition,
  };
  prisma.$transaction = jest.fn(async (work: (tx: any) => Promise<unknown>) => work(prisma));

  const service = new AdminService(prisma, {} as any);
  return { service, prisma, digitalEmployee, systemSetting, getRows: () => rows };
}

describe('AdminService avatar styles', () => {
  it('全局切换只修改 follow-default 员工', async () => {
    const follower = employee();
    const override = employee({
      id: 'employee-2',
      avatar: 'https://example.com/fixed.png',
      avatarStyle: 'custom',
      avatarCustomUrl: 'https://example.com/fixed.png',
    });
    const { service, digitalEmployee, systemSetting } = createHarness([follower, override]);

    const result = await service.batchUpdateAvatarStyle('cartoon:micah', 'admin-1');

    expect(result).toMatchObject({ updated: 1, skipped: 1, styleId: 'cartoon:micah' });
    expect(systemSetting.upsert).toHaveBeenCalledTimes(1);
    expect(digitalEmployee.update).toHaveBeenCalledTimes(1);
    expect(digitalEmployee.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: follower.id } }));
  });

  it('同步全部员工时会把单独设置员工纳入默认风格，同时保留自定义头像', async () => {
    const follower = employee();
    const override = employee({
      id: 'employee-2',
      avatar: 'https://example.com/fixed.png',
      avatarStyle: 'custom',
      avatarCustomUrl: 'https://example.com/fixed.png',
    });
    const { service, digitalEmployee, getRows } = createHarness([follower, override]);

    const result = await service.batchUpdateAvatarStyle('cartoon:micah', 'admin-1', true);

    expect(result).toMatchObject({ updated: 2, skipped: 0, appliedToAll: true, styleId: 'cartoon:micah' });
    expect(getRows().every((item) => item.avatarStyle === 'follow-default')).toBe(true);
    expect(getRows()[1]).toMatchObject({
      avatar: expect.stringContaining('/avatar-library/v1/dicebear/micah'),
      avatarCustomUrl: 'https://example.com/fixed.png',
    });
    expect(digitalEmployee.update).toHaveBeenCalledTimes(2);
  });

  it('从硅基切到卡通后可切回原硅基头像', async () => {
    const source = employee({ avatarStyle: 'silicon-3d' });
    const { service, digitalEmployee, getRows } = createHarness([source]);

    await service.updateEmployeeAvatarStyle(source.id, 'cartoon:micah', 'admin-1');
    expect(getRows()[0].avatar).toContain('/avatar-library/v1/dicebear/micah');
    expect(getRows()[0].avatarBindings['silicon-3d']).toEqual({ portraitUrl: siliconAvatar });

    await service.updateEmployeeAvatarStyle(source.id, 'silicon-3d', 'admin-1');

    expect(digitalEmployee.update).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { id: source.id },
      data: expect.objectContaining({ avatar: siliconAvatar, avatarStyle: 'silicon-3d' }),
    }));
  });

  it('覆盖不完整的平台注册风格不能设为默认且不会写设置或员工', async () => {
    const definition = {
      id: 'studio-real', name: '写实棚拍', description: '平台素材', category: '自有素材',
      source: 'platform', examples: [], recommended: false, totalAssets: 1, active: true,
    };
    const first = employee({ avatarBindings: { 'studio-real': { portraitUrl: '/assets/avatar/one.webp' } } });
    const second = employee({ id: 'employee-2' });
    const { service, digitalEmployee, systemSetting } = createHarness([first, second], [definition]);

    await expect(service.batchUpdateAvatarStyle('studio-real', 'admin-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(systemSetting.upsert).not.toHaveBeenCalled();
    expect(digitalEmployee.update).not.toHaveBeenCalled();
  });

  it('部分绑定的平台风格只对已绑定员工可用', async () => {
    const definition = {
      id: 'studio-real', name: '写实棚拍', description: '平台素材', category: '自有素材',
      source: 'platform', examples: [], recommended: false, totalAssets: 1, active: true,
    };
    const first = employee({ avatarBindings: { 'studio-real': { portraitUrl: '/assets/avatar/one.webp' } } });
    const second = employee({ id: 'employee-2' });
    const { service } = createHarness([first, second], [definition]);

    const result = await service.getAvatarStyles();
    const style = result.styles.find((item) => item.id === 'studio-real');
    const firstView = result.employees.find((item) => item.id === first.id)!;
    const secondView = result.employees.find((item) => item.id === second.id)!;

    expect(style).toMatchObject({ coverage: { matched: 1, total: 2 }, canSetDefault: false });
    expect(firstView.availableStyleIds).toContain('studio-real');
    expect(secondView.availableStyleIds).not.toContain('studio-real');
  });

  it('切换到 custom 时恢复保存的自定义头像', async () => {
    const source = employee({
      avatarStyle: 'silicon-3d',
      avatarCustomUrl: 'https://cdn.example.com/custom.webp',
    });
    const { service, digitalEmployee } = createHarness([source]);

    await service.updateEmployeeAvatarStyle(source.id, 'custom', 'admin-1');

    expect(digitalEmployee.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        avatar: 'https://cdn.example.com/custom.webp',
        avatarStyle: 'custom',
        avatarCustomUrl: 'https://cdn.example.com/custom.webp',
      }),
    }));
  });

  it('固定风格员工不受全局默认切换影响', async () => {
    const follower = employee();
    const fixed = employee({
      id: 'employee-fixed',
      avatar: 'https://api.dicebear.com/9.x/micah/svg?seed=fixed',
      avatarStyle: 'cartoon:micah',
    });
    const { service, digitalEmployee, getRows } = createHarness([follower, fixed]);

    await service.batchUpdateAvatarStyle('cartoon:lorelei', 'admin-1');

    expect(digitalEmployee.update.mock.calls.map(([arg]) => arg.where.id)).toEqual([follower.id]);
    expect(getRows().find((item) => item.id === fixed.id)).toMatchObject({
      avatar: fixed.avatar,
      avatarStyle: 'cartoon:micah',
    });
  });
});


describe('Avatar library source integration', () => {
  it('所有来源返回可用风格、真实来源、许可和绝对预览地址', async () => {
    const { service } = createHarness([employee()]);
    const result = await service.getAvatarStyles();
    expect(result.total).toBe(25);
    expect(result.sources.map((source) => source.id)).toEqual(['platform', 'dicebear', 'open-peeps', 'beanheads', 'robohash']);
    expect(result.styles.filter((style) => style.source === 'dicebear')).toHaveLength(18);
    expect(result.styles.some((style) => ['boring-avatars', 'ui-avatars'].includes(style.source))).toBe(false);
    expect(result.styles.find((style) => style.id === 'cartoon:toon-head')).toMatchObject({
      source: 'dicebear', sourceName: 'DiceBear', license: { name: 'CC BY 4.0', requiresAttribution: true },
      coverage: { matched: 1, total: 1 }, canSetDefault: true,
    });
    for (const style of result.styles.filter((style) => style.source !== 'platform')) {
      expect(style.examples).toHaveLength(3);
      expect(style.examples.every((url) => /^https?:\/\//.test(url))).toBe(true);
      expect(style.license?.attribution).toBeTruthy();
      expect(result.employees[0].availableStyleIds).toContain(style.id);
    }
  });

  it.each(['cartoon:toon-head', 'cartoon:dylan', 'cartoon:bottts', 'cartoon:voxel-bot', 'open-peeps-busts', 'beanheads-professional', 'robohash-set1', 'robohash-set3'])(
    '新增风格 %s 可以单独启用并切回原来的人物', async (styleId) => {
      const initial = employee();
      const { service, getRows } = createHarness([initial]);
      const first = await service.updateEmployeeAvatarStyle(initial.id, styleId, 'admin-1');
      expect(first.avatarAsset?.portraitUrl).toMatch(/^https?:\/\//);
      expect(getRows()[0].avatarBindings[styleId].portraitUrl).toBeTruthy();
      await service.updateEmployeeAvatarStyle(initial.id, 'silicon-3d', 'admin-1');
      expect(getRows()[0].avatar).toBe(siliconAvatar);
      await service.updateEmployeeAvatarStyle(initial.id, styleId, 'admin-1');
      expect(getRows()[0].avatar).toBe(getRows()[0].avatarBindings[styleId].portraitUrl);
    },
  );

  it('Open Peeps 自动选定的人物保存独立头肩图和版本，并支持个人替换', async () => {
    const { service, getRows } = createHarness([employee()]);
    const result = await service.updateEmployeeAvatarStyle('employee-1', 'open-peeps-standing', 'admin-1');
    expect(result.avatarAsset?.faceUrl).toContain('-face.svg');
    expect(result.avatarAsset?.version).toMatch(/^[a-f0-9]{16}$/);
    const binding = getRows()[0].avatarBindings['open-peeps-standing'];
    const renamed = employee({ ...getRows()[0], name: '新名称', position: '新岗位' });
    const other = createHarness([renamed]);
    await other.service.updateEmployeeAvatarStyle('employee-1', 'open-peeps-standing', 'admin-1');
    expect(other.getRows()[0].avatarBindings['open-peeps-standing']).toEqual(binding);
    await service.bindEmployeeAvatar('employee-1', 'open-peeps-standing', {
      portraitUrl: '/assets/curated.svg', faceUrl: '/assets/curated-face.svg', version: 'curated-v1',
    });
    expect(getRows()[0].avatar).toBe('/assets/curated.svg');
  });

  it.each(['beanheads-professional', 'robohash-set1', 'robohash-set3'])('新来源 %s 全局切换仍保留单独设置员工，并保存原硅基人物', async (styleId) => {
    const fixed = employee({ id: 'employee-fixed', avatarStyle: 'custom', avatar: 'https://example.com/custom.png' });
    const { service, getRows } = createHarness([employee(), fixed]);
    await service.batchUpdateAvatarStyle(styleId, 'admin-1');
    expect(getRows()[0].avatar).toBe(getRows()[0].avatarBindings[styleId].portraitUrl);
    expect(getRows()[0].avatarBindings['silicon-3d']).toEqual({ portraitUrl: siliconAvatar });
    expect(getRows()[1].avatar).toBe(fixed.avatar);
  });

  it.each(['boring-beam', 'ui-avatars-brand', 'open-peeps-busts', 'toon-head', 'beanheads-professional', 'robohash-set1'])(
    '不能用 %s 注册覆盖内置来源', async (id) => {
      const { service, prisma } = createHarness([]);
      await expect(service.registerAvatarStyle({ id, name: '覆盖', description: '覆盖', category: 'human' }))
        .rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.avatarStyleDefinition.create).not.toHaveBeenCalled();
    },
  );

  it('纯生成风格不接受素材绑定', async () => {
    const { service } = createHarness([employee()]);
    await expect(service.bindEmployeeAvatar('employee-1', 'boring-beam', { portraitUrl: '/assets/override.svg' }))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});


describe('Character-only avatar selection', () => {
  const removed = ['cartoon:blobs', 'cartoon:constellation', 'cartoon:disco', 'cartoon:gaze', 'cartoon:glass',
    'cartoon:shapes', 'cartoon:lorelei-neutral', 'cartoon:pixelbot', 'boring-beam', 'boring-bauhaus', 'ui-avatars-brand'];
  it('图案和文字头像不再出现在管理页或员工可选风格中', async () => {
    const { service } = createHarness([employee()]);
    const result = await service.getAvatarStyles();
    for (const id of removed) {
      expect(result.styles.some((style) => style.id === id)).toBe(false);
      expect(result.employees[0].availableStyleIds).not.toContain(id);
    }
    expect(result.styles.every((style) => ['human', 'robot', 'pixel'].includes(style.category))).toBe(true);
  });
  it.each(removed)('不能通过接口新选择已移除风格 %s', async (id) => {
    const { service, digitalEmployee, systemSetting } = createHarness([employee()]);
    await expect(service.batchUpdateAvatarStyle(id, 'admin-1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.updateEmployeeAvatarStyle('employee-1', id, 'admin-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(digitalEmployee.update).not.toHaveBeenCalled();
    expect(systemSetting.upsert).not.toHaveBeenCalled();
  });
  it('原来使用已移除风格的员工仍保留头像与绑定，可切换到人物风格', async () => {
    const old = '/avatar-library/v1/dicebear/glass?seed=employee-1';
    const { service, getRows } = createHarness([employee({ avatar: old, avatarStyle: 'cartoon:glass',
      avatarBindings: { 'cartoon:glass': { portraitUrl: old } } })]);
    const result = await service.getAvatarStyles();
    expect(result.employees[0].avatar).toContain('/dicebear/glass');
    await service.updateEmployeeAvatarStyle('employee-1', 'cartoon:toon-head', 'admin-1');
    expect(getRows()[0].avatarBindings['cartoon:glass'].portraitUrl).toBe(old);
  });
});
