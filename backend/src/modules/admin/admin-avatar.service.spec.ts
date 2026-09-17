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

  it('从硅基切到卡通后可切回原硅基头像', async () => {
    const source = employee({ avatarStyle: 'silicon-3d' });
    const { service, digitalEmployee, getRows } = createHarness([source]);

    await service.updateEmployeeAvatarStyle(source.id, 'cartoon:micah', 'admin-1');
    expect(getRows()[0].avatar).toContain('api.dicebear.com');
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
