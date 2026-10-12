import { Prisma } from '@prisma/client';
import { EnterpriseContext } from '../enterprise/enterprise-context.service';

/** Runtime 与产物下载必须使用相同的有效期和成员/部门授权条件。 */
export function clientSubscriptionAccessWhere(
  ctx: EnterpriseContext, subscriptionId: string, now = new Date(),
): Prisma.SubscriptionWhereInput {
  return {
    id: subscriptionId,
    enterpriseId: ctx.enterpriseId,
    status: 'ACTIVE',
    OR: [{ endDate: null }, { endDate: { gt: now } }],
    grants: { some: {
      OR: [{ memberId: ctx.memberId }, ...(ctx.departmentId ? [{ departmentId: ctx.departmentId }] : [])],
      AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
    } },
  };
}
