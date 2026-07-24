import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SubscriptionCreateDto } from 'shared';

@Injectable()
export class SubscriptionService {
  constructor(private prisma: PrismaService) {}

  /**
   * Subscribe user to a digital employee.
   * Rules:
   *  - Employee must be PUBLISHED
   *  - One active subscription per (user, employee) pair; reactivates if PAUSED/EXPIRED
   */
  async subscribe(userId: string, dto: SubscriptionCreateDto) {
    const employee = await this.prisma.digitalEmployee.findUnique({
      where: { id: dto.employeeId },
    });
    if (!employee) throw new NotFoundException(`Employee ${dto.employeeId} not found`);
    if (employee.status !== 'PUBLISHED') {
      throw new BadRequestException('Cannot subscribe to an unpublished employee');
    }

    // Upsert: reactivate existing or create new
    const existing = await this.prisma.subscription.findUnique({
      where: { userId_employeeId: { userId, employeeId: dto.employeeId } },
    });

    if (existing) {
      if (existing.status === 'ACTIVE') {
        throw new ConflictException('Already subscribed to this employee');
      }
      // Reactivate paused / expired subscription
      return this.prisma.subscription.update({
        where: { id: existing.id },
        data: { status: 'ACTIVE', startDate: new Date(), endDate: null, config: dto.config ?? undefined },
        include: { employee: { select: { id: true, name: true, avatar: true, position: true } } },
      });
    }

    return this.prisma.subscription.create({
      data: {
        userId,
        employeeId: dto.employeeId,
        status: 'ACTIVE',
        config: dto.config,
      },
      include: { employee: { select: { id: true, name: true, avatar: true, position: true } } },
    });
  }

  /** List all active subscriptions for the authenticated user */
  async findAll(userId: string) {
    return this.prisma.subscription.findMany({
      where: { userId, status: 'ACTIVE' },
      include: {
        employee: {
          select: {
            id: true, name: true, description: true, avatar: true,
            industry: true, position: true, status: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Get a single subscription by id (must belong to the user) */
  async findOne(id: string, userId: string) {
    const sub = await this.prisma.subscription.findUnique({
      where: { id },
      include: { employee: true },
    });
    if (!sub) throw new NotFoundException(`Subscription ${id} not found`);
    if (sub.userId !== userId) throw new ForbiddenException('Not your subscription');
    return sub;
  }

  /** Update the user-specific config on a subscription */
  async updateConfig(id: string, userId: string, config: Record<string, any>) {
    const sub = await this.findOne(id, userId);
    return this.prisma.subscription.update({
      where: { id: sub.id },
      data: { config: config as any },
      include: { employee: { select: { id: true, name: true, avatar: true, position: true } } },
    });
  }

  /** Unsubscribe (set status to EXPIRED, keep record) */
  async unsubscribe(id: string, userId: string) {
    const sub = await this.findOne(id, userId);
    if (sub.status !== 'ACTIVE') {
      throw new ConflictException('Subscription is not active');
    }
    return this.prisma.subscription.update({
      where: { id: sub.id },
      data: { status: 'EXPIRED', endDate: new Date() },
    });
  }

  /** Check whether the user has an active subscription for an employee (used by conversation layer) */
  async assertActiveSubscription(userId: string, employeeId: string): Promise<void> {
    const sub = await this.prisma.subscription.findUnique({
      where: { userId_employeeId: { userId, employeeId } },
    });
    if (!sub || sub.status !== 'ACTIVE') {
      throw new ForbiddenException('Active subscription required to start a conversation');
    }
  }
}
