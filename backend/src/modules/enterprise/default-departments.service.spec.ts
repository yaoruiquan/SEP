/**
 * 默认部门树测试。
 *
 * 关注三件会真出问题的事：
 *   ① 幂等 —— 重复调用不该在管理员改过的架构上再叠一套默认部门；
 *   ② 组挂在父部门下 —— 若 parentId 丢了，17 个部门会全平铺在顶级；
 *   ③ 多租户隔离 —— 每条记录都必须带 enterpriseId，含子部门。
 */
import { DefaultDepartmentsService } from './default-departments.service';

const ENTERPRISE_ID = 'ent-1';

describe('DefaultDepartmentsService', () => {
  let prisma: any;
  let svc: DefaultDepartmentsService;

  beforeEach(() => {
    prisma = {
      department: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn((a: any) => Promise.resolve({ id: 'dept-x', ...a.data })),
      },
      // 真实 $transaction 收数组时会执行里面的 promise，这里如实模拟
      $transaction: jest.fn((ops: any[]) => Promise.all(ops)),
    };
    svc = new DefaultDepartmentsService(prisma);
  });

  it('建出 5 个顶级部门，每个都带 enterpriseId', async () => {
    await svc.createDefaultDepartments(ENTERPRISE_ID);

    expect(prisma.department.create).toHaveBeenCalledTimes(5);

    const names = prisma.department.create.mock.calls.map(
      ([a]: any) => a.data.name,
    );
    expect(names).toEqual([
      '技术部',
      '产品部',
      '市场部',
      '销售部',
      '客户服务部',
    ]);

    for (const [arg] of prisma.department.create.mock.calls) {
      expect(arg.data.enterpriseId).toBe(ENTERPRISE_ID);
    }
  });

  it('组作为子部门嵌套创建，且同样带 enterpriseId', async () => {
    await svc.createDefaultDepartments(ENTERPRISE_ID);

    const [techArg] = prisma.department.create.mock.calls[0];
    const groups = techArg.data.children.create;

    expect(groups.map((g: any) => g.name)).toEqual([
      '研发组',
      '测试组',
      '运维组',
    ]);
    // 漏了 enterpriseId 的子部门会成为跨租户可见的孤儿数据
    for (const g of groups) {
      expect(g.enterpriseId).toBe(ENTERPRISE_ID);
    }
  });

  it('共 11 个组（技术 3 + 产品 2 + 市场 2 + 销售 2 + 客服 2）', async () => {
    await svc.createDefaultDepartments(ENTERPRISE_ID);

    const total = prisma.department.create.mock.calls.reduce(
      (n: number, [a]: any) => n + a.data.children.create.length,
      0,
    );
    expect(total).toBe(11);
  });

  it('sortOrder 从 1 起递增，部门与组各自独立编号', async () => {
    await svc.createDefaultDepartments(ENTERPRISE_ID);

    const orders = prisma.department.create.mock.calls.map(
      ([a]: any) => a.data.sortOrder,
    );
    expect(orders).toEqual([1, 2, 3, 4, 5]);

    const [techArg] = prisma.department.create.mock.calls[0];
    expect(techArg.data.children.create.map((g: any) => g.sortOrder)).toEqual([
      1, 2, 3,
    ]);
  });

  it('已有部门 → 直接返回，不追加也不覆盖', async () => {
    prisma.department.findFirst.mockResolvedValue({ id: 'dept-existing' });

    await svc.createDefaultDepartments(ENTERPRISE_ID);

    expect(prisma.department.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('查已有部门时按 enterpriseId 过滤 —— 否则别家有部门就跳过本家', async () => {
    await svc.createDefaultDepartments(ENTERPRISE_ID);

    expect(prisma.department.findFirst).toHaveBeenCalledWith({
      where: { enterpriseId: ENTERPRISE_ID },
      select: { id: true },
    });
  });

  it('全部写入在同一事务里 —— 不留半棵树', async () => {
    await svc.createDefaultDepartments(ENTERPRISE_ID);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction.mock.calls[0][0]).toHaveLength(5);
  });

  it('写库失败照常上抛 —— 由调用方决定咽不咽', async () => {
    prisma.$transaction.mockRejectedValue(new Error('DB down'));

    await expect(svc.createDefaultDepartments(ENTERPRISE_ID)).rejects.toThrow(
      'DB down',
    );
  });
});
