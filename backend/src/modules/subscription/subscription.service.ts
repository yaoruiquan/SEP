import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  SubscriptionCreateDto,
  SubscriptionUpdateDto,
  SubscriptionStatusValue,
} from 'shared';
import { EnterpriseContextService } from '../enterprise/enterprise-context.service';

/** 允许的状态流转。EXPIRED 是终态。 */
const ALLOWED_TRANSITIONS: Record<
  SubscriptionStatusValue,
  SubscriptionStatusValue[]
> = {
  ACTIVE: ['PAUSED', 'EXPIRED'],
  PAUSED: ['ACTIVE', 'EXPIRED'],
  // 终止后不可复活：凭据已吊销，重新雇佣走 subscribe() 而非状态回滚，
  // 那样 startDate 会刷新，审计上能看出这是一次新的雇佣
  EXPIRED: [],
};

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
   *  - 订阅本身即雇佣关系，创建时锁定模板版本，不再另建实例
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

    let subscription;
    if (existing) {
      if (existing.status === 'ACTIVE') {
        throw new ConflictException('Already subscribed to this employee');
      }
      // 复活暂停 / 已终止的雇佣关系。
      // 刻意不刷新 templateVersion：停用期间模板可能已发新版，保留旧版本
      // 会让列表立刻给出升级提示，企业能知道「离开这段时间员工变了」。
      // 若在此改成当前版本，这次变更就被静默吞掉了。
      subscription = await this.prisma.subscription.update({
        where: { id: existing.id },
        data: { status: 'ACTIVE', startDate: new Date(), endDate: null, config: dto.config ?? undefined },
        include: { employee: { select: { id: true, name: true, avatar: true, position: true } } },
      });
    } else {
      // 收敛后订阅即雇佣关系，创建时就锁定模板版本并落默认称呼，
      // 不再需要额外建实例。
      subscription = await this.prisma.subscription.create({
        data: {
          enterpriseId: ctx.enterpriseId,
          employeeId: dto.employeeId,
          status: 'ACTIVE',
          templateVersion: employee.version,
          name: employee.name,
          config: dto.config,
        },
        include: { employee: { select: { id: true, name: true, avatar: true, position: true } } },
      });
    }

    return subscription;
  }

  /**
   * 列出【本企业】的雇佣关系，并附带升级提示。
   *
   * 不再按 status 过滤 —— 管理台要能看到已暂停的雇佣关系才能恢复它，
   * 只返回 ACTIVE 会让暂停后的记录凭空消失、无从操作。
   *
   * 升级判断只比较版本字符串是否相等，不做语义化版本比较 ——
   * 模板版本由运营发布时填写，只要与雇佣关系锁定的版本不同就提示。
   * 这样降级发布（如撤回到旧版）也会被提示，符合「有变化就告知」的预期。
   */
  async findAll(userId: string) {
    const ctx = await this.enterpriseContext.resolve(userId);
    const rows = await this.prisma.subscription.findMany({
      where: { enterpriseId: ctx.enterpriseId },
      include: {
        employee: {
          select: {
            id: true, name: true, description: true, avatar: true,
            industry: true, position: true, status: true, version: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map((r) => ({
      ...r,
      // 未自定义称呼时回落到模板名，前端不必各自兜底
      name: r.name ?? r.employee.name,
      latestVersion: r.employee.version,
      upgradeAvailable: r.employee.version !== r.templateVersion,
    }));
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

  /**
   * 修改雇佣关系（自定义称呼 / 配置）。
   *
   * 已过期的不可改：过期是终态，改名改配置都无从生效，
   * 允许修改只会让管理台显示出「改了但没用」的假象。
   */
  async update(id: string, userId: string, dto: SubscriptionUpdateDto) {
    const ctx = await this.enterpriseContext.resolve(userId);
    this.enterpriseContext.assertEnterpriseAdmin(ctx);
    const sub = await this.findOne(id, userId);

    if (sub.status === 'EXPIRED') {
      throw new ConflictException('已过期的雇佣关系不可修改');
    }

    return this.prisma.subscription.update({
      where: { id: sub.id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.config !== undefined && { config: dto.config as any }),
      },
      select: { id: true, name: true, config: true, status: true },
    });
  }

  /**
   * 变更雇佣关系状态（启用 / 暂停 / 终止）。
   *
   * 暂停与终止**不删除授权记录**：暂停往往是临时的，删掉授权则恢复时
   * 要重新配一遍，是无谓的返工。权限判定由「雇佣关系状态 + 授权」
   * 共同决定 —— 非 ACTIVE 时一律不可用，授权记录留着不生效。
   *
   * EXPIRED 是终态，不可转回：凭据已吊销，且「终止雇佣」对企业是一次
   * 明确的动作，允许撤销会让权限状态难以审计。想重新雇佣走订阅流程，
   * 那会走 subscribe() 的复活分支并刷新 startDate。
   */
  async changeStatus(
    id: string,
    userId: string,
    next: SubscriptionStatusValue,
  ) {
    const ctx = await this.enterpriseContext.resolve(userId);
    this.enterpriseContext.assertEnterpriseAdmin(ctx);
    const sub = await this.findOne(id, userId);

    const current = sub.status as SubscriptionStatusValue;
    if (current === next) {
      return { id: sub.id, status: current, changed: false };
    }
    if (!ALLOWED_TRANSITIONS[current].includes(next)) {
      throw new ConflictException(
        `雇佣关系状态不能从 ${current} 变为 ${next}`,
      );
    }

    const updated = await this.prisma.subscription.update({
      where: { id: sub.id },
      data: {
        status: next,
        // 终止时落下结束时间，恢复时清掉，否则列表会显示一个过去的到期日
        ...(next === 'EXPIRED'
          ? { endDate: new Date() }
          : { endDate: null }),
      },
      select: { id: true, status: true },
    });
    return { ...updated, changed: true };
  }

  /**
   * 升级到模板最新版本（提示式升级，由企业主动确认，决策 14）。
   *
   * **不迁移 config**：新版可能增删配置项，自动迁移需要清单声明配置项的
   * 版本演进规则，成本高且容易静默写坏数据。这里只更新版本号并把结果
   * 告知调用方，由前端提示「请重新检查配置」。
   */
  async upgrade(id: string, userId: string) {
    const ctx = await this.enterpriseContext.resolve(userId);
    this.enterpriseContext.assertEnterpriseAdmin(ctx);
    const sub = await this.findOne(id, userId);

    if (sub.status === 'EXPIRED') {
      throw new ConflictException('已过期的雇佣关系不可升级');
    }

    const employee = await this.prisma.digitalEmployee.findUnique({
      where: { id: sub.employeeId },
      select: { version: true },
    });
    if (!employee) throw new NotFoundException('员工模板不存在');

    if (employee.version === sub.templateVersion) {
      throw new ConflictException('当前已是最新版本');
    }

    const from = sub.templateVersion;
    const updated = await this.prisma.subscription.update({
      where: { id: sub.id },
      data: { templateVersion: employee.version },
      select: { id: true, templateVersion: true },
    });

    return {
      ...updated,
      from,
      to: employee.version,
      // 提醒前端：配置未自动迁移
      configReviewRequired: true,
    };
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
