import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SubscriptionCreateDto } from 'shared';
import { EnterpriseContextService } from '../enterprise/enterprise-context.service';

@Injectable()
export class SubscriptionService {
  constructor(
    private prisma: PrismaService,
    private enterpriseContext: EnterpriseContextService,
  ) {}

  /**
   * 企业订阅一个市场员工模板。
   *
   * 订阅主体是【企业】而非个人 —— 订阅要花企业的钱，
   * 故要求 ENTERPRISE_ADMIN 角色；其他角色应走 AccessRequest 申请流程。
   *
   * 规则：
   *  - 模板必须已上架（PUBLISHED）
   *  - 同一企业对同一模板只订阅一次；PAUSED/EXPIRED 时重新激活
   *  - 多实例在 EmployeeInstance 层展开（一次订阅可开多个实例）
   */
  async subscribe(userId: string, dto: SubscriptionCreateDto) {
    const ctx = await this.enterpriseContext.resolve(userId);
    this.enterpriseContext.assertEnterpriseAdmin(ctx);

    const employee = await this.prisma.digitalEmployee.findUnique({
      where: { id: dto.employeeId },
    });
    if (!employee) throw new NotFoundException(`Employee ${dto.employeeId} not found`);
    if (employee.status !== 'APPROVED') {
      throw new BadRequestException('Cannot subscribe to an unapproved employee');
    }

    // Upsert: reactivate existing or create new
    const existing = await this.prisma.subscription.findUnique({
      where: {
        enterpriseId_employeeId: {
          enterpriseId: ctx.enterpriseId,
          employeeId: dto.employeeId,
        },
      },
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
        enterpriseId: ctx.enterpriseId,
        employeeId: dto.employeeId,
        status: 'ACTIVE',
        config: dto.config,
      },
      include: { employee: { select: { id: true, name: true, avatar: true, position: true } } },
    });
  }

  /** 列出【本企业】的有效订阅 */
  async findAll(userId: string) {
    const ctx = await this.enterpriseContext.resolve(userId);
    return this.prisma.subscription.findMany({
      where: { enterpriseId: ctx.enterpriseId, status: 'ACTIVE' },
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

  /**
   * 按 id 取单个订阅，并校验其属于调用方所在企业。
   *
   * ⚠️ 多租户防线：这里必须比对 enterpriseId 而非 userId ——
   * 攻击者会直接把 URL 里的 id 换成别家企业的订阅 id 来调接口，
   * 仅靠"前端只展示本企业数据"挡不住。
   */
  async findOne(id: string, userId: string) {
    const ctx = await this.enterpriseContext.resolve(userId);
    const sub = await this.prisma.subscription.findUnique({
      where: { id },
      include: { employee: true },
    });
    if (!sub) throw new NotFoundException(`Subscription ${id} not found`);
    if (sub.enterpriseId !== ctx.enterpriseId) {
      // 用 404 而非 403：不向越权者确认该资源是否存在
      throw new NotFoundException(`Subscription ${id} not found`);
    }
    return sub;
  }

  /** 更新订阅上的企业侧配置 */
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

  /**
   * 校验企业对某员工有有效订阅（对话层调用前检查）。
   * 订阅主体是企业，从 userId 解析出企业后再查。
   */
  async assertActiveSubscription(userId: string, employeeId: string): Promise<void> {
    const ctx = await this.enterpriseContext.resolve(userId);
    const sub = await this.prisma.subscription.findUnique({
      where: {
        enterpriseId_employeeId: {
          enterpriseId: ctx.enterpriseId,
          employeeId,
        },
      },
    });
    if (!sub || sub.status !== 'ACTIVE') {
      throw new ForbiddenException('Active subscription required to start a conversation');
    }
  }
}
