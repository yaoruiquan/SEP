import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

/** Serialize new enterprise business writes with enterprise closure. Lock users first when needed. */
export async function assertActiveEnterpriseInTx(tx: Prisma.TransactionClient, enterpriseId: string) {
  const rows = await tx.$queryRaw<Array<{ status: string }>>`
    SELECT status FROM enterprises WHERE id = ${enterpriseId} FOR UPDATE
  `;
  if (rows[0]?.status !== 'ACTIVE') throw new ConflictException('企业已关闭，不能新增业务或资金变动');
}

export async function assertActiveUserInTx(tx: Prisma.TransactionClient, userId: string) {
  const rows = await tx.$queryRaw<Array<{ status: string }>>`
    SELECT status FROM users WHERE id = ${userId} FOR UPDATE
  `;
  if (rows[0]?.status !== 'ACTIVE') throw new ConflictException('账号当前不可新增业务');
}
