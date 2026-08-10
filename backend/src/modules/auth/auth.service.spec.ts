/**
 * 认证服务测试。
 *
 * 目前只覆盖 `createEnterprise`（无归属账号自行开公司），因为它是
 * 状态机里唯一能把 `[无归属]` 翻成 `[企业管理员]` 的边，出错的后果分两类：
 *   ① 事务不完整 → 企业建了但没 ComputeAccount，订阅时无处扣费；
 *      或没 Member，用户看着公司存在却永远进不去。
 *   ② 已有归属者放行 → MVP 前端按单企业渲染（取最早一条 membership），
 *      新建的那家会成为"看不见的归属"：数据建了，界面永远进不去。
 */
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

const USER = {
  id: 'user-solo',
  email: 'solo@example.com',
  name: '独立用户',
  role: 'USER',
};

describe('AuthService.createEnterprise', () => {
  let prisma: any;
  let tx: any;
  let jwt: any;
  let config: any;
  let invitations: any;
  let res: any;
  let svc: AuthService;

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(USER) },
      // 默认无归属 —— 这是本方法唯一允许的前置状态
      enterpriseMember: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    // 事务内的 client 用同一个 tx 对象，便于断言事务里究竟发生了什么
    tx = {
      enterprise: {
        create: jest.fn((a: any) =>
          Promise.resolve({ id: 'ent-new', name: a.data.name }),
        ),
      },
      enterpriseMember: {
        create: jest.fn((a: any) => Promise.resolve({ id: 'mem-new', ...a.data })),
      },
    };
    prisma.$transaction = jest.fn((fn: any) => fn(tx));

    // 按 payload.type 区分两种 token，否则无法断言"cookie 里放的是 refresh"
    jwt = {
      sign: jest.fn((payload: any) =>
        payload.type === 'refresh' ? 'refresh-jwt' : 'access-jwt',
      ),
    };
    config = { get: jest.fn().mockReturnValue(undefined) };
    invitations = { findUsableByToken: jest.fn() };
    res = { cookie: jest.fn() };

    svc = new AuthService(prisma, jwt, config, invitations);
  });

  it('一个事务里建出企业 + 算力账户 + 管理员成员', async () => {
    const result = await svc.createEnterprise(USER.id, { name: '新公司' }, res);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);

    // ComputeAccount 必须与企业同事务创建：分开建则中途失败会留下
    // 一家无法扣费的企业，订阅流程在下单时才炸
    expect(tx.enterprise.create).toHaveBeenCalledWith({
      data: {
        name: '新公司',
        computeAccount: { create: { balance: 0 } },
      },
    });

    // 开公司的人就是首个企业管理员 —— 这个身份无法自行申请
    expect(tx.enterpriseMember.create).toHaveBeenCalledWith({
      data: {
        userId: USER.id,
        enterpriseId: 'ent-new',
        role: 'ENTERPRISE_ADMIN',
      },
    });

    // 不建 User：本方法的前提就是账号已存在
    expect(tx.user).toBeUndefined();

    expect(result).toEqual({
      token: 'access-jwt',
      user: USER,
      enterprise: { id: 'ent-new', name: '新公司' },
      roleInEnterprise: 'ENTERPRISE_ADMIN',
    });
  });

  it('返回体带上新企业与角色 —— 前端靠它把 store 里的 enterprise 从 null 换掉', async () => {
    const result = await svc.createEnterprise(USER.id, { name: '新公司' }, res);

    // 少了任何一个，前端就停在 /no-enterprise 落地页出不去
    expect(result.enterprise).not.toBeNull();
    expect(result.roleInEnterprise).toBe('ENTERPRISE_ADMIN');
    expect(result.token).toBeTruthy();
  });

  it('顺带续一次 refresh cookie，且是 httpOnly', async () => {
    await svc.createEnterprise(USER.id, { name: '新公司' }, res);

    expect(res.cookie).toHaveBeenCalledTimes(1);
    const [name, value, options] = res.cookie.mock.calls[0];
    expect(name).toBe('refresh_token');
    // cookie 里放的必须是 refresh token，放 access 等于把 1h 的凭据当 7d 用
    expect(value).toBe('refresh-jwt');
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe('lax');
  });

  it('已有归属者一律拒绝 —— 否则新公司会成为看不见的归属', async () => {
    prisma.enterpriseMember.findFirst.mockResolvedValue({ id: 'mem-existing' });

    await expect(
      svc.createEnterprise(USER.id, { name: '第二家公司' }, res),
    ).rejects.toThrow(ConflictException);

    // 拒绝要发生在事务之前：不能建完再回滚，也不能留下半个企业
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.enterprise.create).not.toHaveBeenCalled();
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('拒绝信息告诉用户下一步怎么走（先退出当前企业）', async () => {
    prisma.enterpriseMember.findFirst.mockResolvedValue({ id: 'mem-existing' });

    await expect(
      svc.createEnterprise(USER.id, { name: '第二家公司' }, res),
    ).rejects.toThrow('你已归属企业，如需开新公司请先在个人设置中退出当前企业');
  });

  it('token 有效但用户已被删除 → 401，不建出无主企业', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      svc.createEnterprise('user-deleted', { name: '幽灵公司' }, res),
    ).rejects.toThrow(UnauthorizedException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.enterprise.create).not.toHaveBeenCalled();
  });
});
