import { DashboardService } from './dashboard.service';
import { EnterpriseContextService } from '../enterprise/enterprise-context.service';

describe('DashboardService', () => {
  const prisma = {
    subscription: { findMany: jest.fn() },
    enterpriseMember: { count: jest.fn() },
    department: { count: jest.fn() },
    conversationSession: { findMany: jest.fn(), count: jest.fn() },
    enterpriseWallet: { findUnique: jest.fn() },
    computeAccount: { findUnique: jest.fn() },
    computeTransaction: { aggregate: jest.fn(), findMany: jest.fn() },
  } as any;
  const context = { resolve: jest.fn() } as unknown as EnterpriseContextService;
  let service: DashboardService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DashboardService(prisma, context);
    prisma.subscription.findMany.mockResolvedValue([{ employeeId: 'employee-1' }]);
    prisma.enterpriseMember.count.mockResolvedValue(8);
    prisma.department.count.mockResolvedValue(2);
    prisma.conversationSession.findMany.mockResolvedValue([]);
    prisma.conversationSession.count.mockResolvedValue(3);
    prisma.enterpriseWallet.findUnique.mockResolvedValue({ balance: 100 });
    prisma.computeAccount.findUnique.mockResolvedValue({ id: 'account-1' });
    prisma.computeTransaction.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
    prisma.computeTransaction.findMany.mockResolvedValue([]);
  });

  it('普通成员只查询本人和被授权员工，并隐藏企业人数与钱包余额', async () => {
    context.resolve = jest.fn().mockResolvedValue({
      enterpriseId: 'enterprise-1',
      memberId: 'member-1',
      role: 'MEMBER',
      departmentId: 'department-1',
    });

    const result = await service.getEnterpriseStats('user-1');

    expect(result.scope).toBe('member');
    expect(result.stats.totalMembers).toBe(0);
    expect(result.stats.totalDepartments).toBe(0);
    expect(result.stats.balance).toBe(0);
    expect(prisma.subscription.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        enterpriseId: 'enterprise-1',
        grants: {
          some: {
            OR: [{ memberId: 'member-1' }, { departmentId: 'department-1' }],
          },
        },
      }),
      select: { employeeId: true },
    });

    const conversationCall = prisma.conversationSession.findMany.mock.calls[0][0];
    expect(conversationCall.where.user).toEqual({ id: 'user-1' });
    expect(conversationCall.where.employeeId).toEqual({ in: ['employee-1'] });
    const transactionCall = prisma.computeTransaction.aggregate.mock.calls[0][0];
    expect(transactionCall.where.metadata).toEqual({
      path: ['memberId'],
      equals: 'member-1',
    });
  });

  it('企业管理员查询企业范围并返回成员统计', async () => {
    context.resolve = jest.fn().mockResolvedValue({
      enterpriseId: 'enterprise-1',
      memberId: 'admin-member',
      role: 'ENTERPRISE_ADMIN',
      departmentId: null,
    });

    const result = await service.getEnterpriseStats('admin-user');

    expect(result.scope).toBe('enterprise');
    expect(result.stats.totalMembers).toBe(8);
    expect(result.stats.totalDepartments).toBe(2);
    const conversationCall = prisma.conversationSession.findMany.mock.calls[0][0];
    expect(conversationCall.where.user).toEqual({ memberships: { some: { enterpriseId: 'enterprise-1' } } });
    expect(prisma.enterpriseWallet.findUnique).toHaveBeenCalledWith({ where: { enterpriseId: 'enterprise-1' } });
  });
});
