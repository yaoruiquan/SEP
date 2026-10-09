import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class EnterpriseSkillDefaultService {
  constructor(private readonly prisma: PrismaService) {}

  async lock(tx: Prisma.TransactionClient, enterpriseId: string, capabilityId: string): Promise<void> {
    const key = JSON.stringify(['enterprise-skill-default', enterpriseId, capabilityId]);
    // Execute-only avoids decoding PostgreSQL's void advisory-lock result.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  }

  // The caller validates the version and acquires lock() in this transaction first.
  async set(
    tx: Prisma.TransactionClient,
    enterpriseId: string,
    capabilityId: string,
    versionId: string,
    userId: string,
  ): Promise<{ affectedSubscriptions: number }> {
    const now = new Date();
    const selection = { versionId, selectedById: userId, selectedAt: now };

    await tx.enterpriseSkillDefault.upsert({
      where: { enterpriseId_capabilityId: { enterpriseId, capabilityId } },
      create: { enterpriseId, capabilityId, ...selection },
      update: selection,
    });

    const subscriptions = await tx.subscription.findMany({
      where: {
        enterpriseId,
        status: 'ACTIVE',
        OR: [{ endDate: null }, { endDate: { gt: now } }],
        employee: {
          bindings: { some: { capabilityId, enabled: true, capability: { type: 'SKILL' } } },
        },
      },
      select: { id: true },
    });

    for (const subscription of subscriptions) {
      await tx.subscriptionSkillVersion.upsert({
        where: { subscriptionId_capabilityId: { subscriptionId: subscription.id, capabilityId } },
        create: { subscriptionId: subscription.id, capabilityId, ...selection },
        update: selection,
      });
    }

    return { affectedSubscriptions: subscriptions.length };
  }

  async get(enterpriseId: string, capabilityId: string, tx: Prisma.TransactionClient = this.prisma) {
    return tx.enterpriseSkillDefault.findUnique({
      where: { enterpriseId_capabilityId: { enterpriseId, capabilityId } },
      include: { version: true },
    });
  }
}
