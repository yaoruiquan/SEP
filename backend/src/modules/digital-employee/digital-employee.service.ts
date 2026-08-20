import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  DigitalEmployeeCreateDto,
  DigitalEmployeeUpdateDto,
  BindCapabilityDto,
} from 'shared';

@Injectable()
export class DigitalEmployeeService {
  constructor(private readonly prisma: PrismaService) {}

  // ────────────────────────────────────────────────────────────────────────────
  // CRUD
  // ────────────────────────────────────────────────────────────────────────────

  async create(dto: DigitalEmployeeCreateDto) {
    let defaultVersions = new Map<string, string>();
    if (dto.capabilityIds.length > 0) {
      await this.validateCapabilitiesApproved(dto.capabilityIds);
      defaultVersions = await this.getDefaultSkillVersionIds(dto.capabilityIds);
    }

    // Build base data object explicitly to satisfy Prisma's required field types
    const baseData = {
      name: dto.name,
      description: dto.description,
      industry: dto.industry,
      position: dto.position,
      avatar: dto.avatar,
      systemPrompt: dto.systemPrompt,
      modelId: dto.modelId,
      maxSteps: dto.maxSteps,
      price: dto.price,
    };

    if (dto.capabilityIds.length > 0) {
      return this.prisma.digitalEmployee.create({
        data: {
          ...baseData,
          bindings: {
            create: dto.capabilityIds.map((capabilityId, index) => ({
              capabilityId,
              priority: index,
              defaultSkillVersionId: defaultVersions.get(capabilityId),
            })),
          },
        },
        include: this.defaultInclude(),
      });
    }

    return this.prisma.digitalEmployee.create({
      data: baseData,
      include: this.defaultInclude(),
    });
  }

  async findAll(status?: string) {
    return this.prisma.digitalEmployee.findMany({
      where: status ? { status: status as any } : undefined,
      include: {
        ...this.defaultInclude(),
        _count: { select: { subscriptions: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * 人才市场的**公开**员工列表 —— 无需登录。
   *
   * 与 findAll 的两个关键差异，都是安全相关，不要合并这两个方法：
   * ① status 硬编码为 APPROVED，不接受调用方传参 —— 否则访客传
   *    `?status=DRAFT` 就能看到未上架的员工；
   * ② 用 select 白名单而非 include，**不返回 systemPrompt / modelId /
   *    maxSteps**。提示词基本等于这个员工的全部内容，公开即可被完整复制。
   *    这些字段只在已登录的管理端/订阅方接口里返回。
   */
  async findPublicList(search?: string) {
    const q = search?.trim();
    return this.prisma.digitalEmployee.findMany({
      where: {
        status: 'APPROVED',
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' as const } },
                { description: { contains: q, mode: 'insensitive' as const } },
                { industry: { contains: q, mode: 'insensitive' as const } },
                { position: { contains: q, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      select: this.publicSelect(),
      orderBy: { publishedAt: 'desc' },
    });
  }

  /** 公开员工详情。同样只返回白名单字段，且非 APPROVED 一律 404。 */
  async findPublicOne(id: string) {
    const employee = await this.prisma.digitalEmployee.findFirst({
      where: { id, status: 'APPROVED' },
      select: this.publicSelect(),
    });
    if (!employee) {
      // 未上架的员工对访客应表现为「不存在」，不泄漏其存在性
      throw new NotFoundException(`员工 ${id} 不存在`);
    }
    return employee;
  }

  /**
   * 公开字段白名单。**新增字段时默认不要加进来** ——
   * 加之前先问：访客看到它有没有问题。
   */
  private publicSelect() {
    return {
      id: true,
      name: true,
      description: true,
      industry: true,
      position: true,
      avatar: true,
      price: true, // DEPRECATED - 保留兼容旧数据
      annualPriceCNY: true,
      includedComputeCNY: true,
      version: true,
      publishedAt: true,
      bindings: {
        select: {
          id: true,
          priority: true,
          // 名称/类型/描述用于展示「这个员工会做什么」—— 描述是营销文案，
          // 公开无妨，且详情页只有名称和类型太单薄。
          // 但**不给** config / apiKey / inputSchema 等实现与凭据字段。
          capability: {
            select: { id: true, name: true, type: true, description: true },
          },
        },
        orderBy: { priority: 'asc' as const },
      },
      _count: { select: { subscriptions: true } },
    };
  }

  async findOne(id: string) {
    const employee = await this.prisma.digitalEmployee.findUnique({
      where: { id },
      include: {
        bindings: {
          include: {
            capability: {
              select: {
                id: true,
                name: true,
                type: true,
                description: true,
                inputSchema: true,
                outputSchema: true,
                status: true,
              },
            },
          },
          orderBy: { priority: 'asc' },
        },
        _count: { select: { subscriptions: true } },
      },
    });

    if (!employee) {
      throw new NotFoundException(`Digital employee ${id} not found`);
    }

    return employee;
  }

  async update(id: string, dto: DigitalEmployeeUpdateDto) {
    await this.findOne(id); // guard: throws NotFoundException if missing

    return this.prisma.digitalEmployee.update({
      where: { id },
      data: {
        ...dto,
        // Auto-stamp publishedAt when status transitions to APPROVED
        ...(dto.status === 'APPROVED' && { publishedAt: new Date() }),
      },
      include: this.defaultInclude(),
    });
  }

  async remove(id: string) {
    await this.findOne(id); // guard
    await this.prisma.digitalEmployee.delete({ where: { id } });
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Capability Binding
  // ────────────────────────────────────────────────────────────────────────────

  async bindCapability(employeeId: string, dto: BindCapabilityDto) {
    await this.findOne(employeeId);
    await this.validateCapabilitiesApproved([dto.capabilityId]);
    const defaultVersions = await this.getDefaultSkillVersionIds([dto.capabilityId]);

    try {
      return await this.prisma.employeeCapabilityBinding.create({
        data: {
          employeeId,
          capabilityId: dto.capabilityId,
          priority: dto.priority,
          defaultSkillVersionId: defaultVersions.get(dto.capabilityId),
        },
        include: {
          capability: { select: { id: true, name: true, type: true, description: true } },
        },
      });
    } catch (err: any) {
      if (err.code === 'P2002') {
        throw new ConflictException('Capability already bound to this employee');
      }
      throw err;
    }
  }

  private async getDefaultSkillVersionIds(capabilityIds: string[]) {
    const versions = await this.prisma.skillVersion.findMany({
      where: {
        capabilityId: { in: capabilityIds },
        scope: 'PLATFORM',
        status: 'PLATFORM_APPROVED',
      },
      select: { id: true, capabilityId: true },
      orderBy: { createdAt: 'desc' },
    });
    const defaults = new Map<string, string>();
    for (const version of versions) {
      if (!defaults.has(version.capabilityId)) defaults.set(version.capabilityId, version.id);
    }
    return defaults;
  }

  async unbindCapability(employeeId: string, capabilityId: string) {
    await this.findOne(employeeId);

    const binding = await this.prisma.employeeCapabilityBinding.findUnique({
      where: { employeeId_capabilityId: { employeeId, capabilityId } },
    });

    if (!binding) {
      throw new NotFoundException('Capability binding not found');
    }

    await this.prisma.employeeCapabilityBinding.delete({
      where: { employeeId_capabilityId: { employeeId, capabilityId } },
    });
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Stats / Monitoring
  // ────────────────────────────────────────────────────────────────────────────

  async getStats(employeeId: string, days: number, userId: string) {
    const employee = await this.prisma.digitalEmployee.findUnique({
      where: { id: employeeId },
      select: { id: true },
    });
    if (!employee) {
      throw new NotFoundException(`Digital employee ${employeeId} not found`);
    }

    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Fetch sessions for this employee within the window
    const sessions = await this.prisma.conversationSession.findMany({
      where: { employeeId, userId, createdAt: { gte: startDate } },
      select: { id: true, createdAt: true },
    });

    const sessionIds = sessions.map((s) => s.id);

    // Fetch all tool executions for these sessions
    const executions =
      sessionIds.length > 0
        ? await this.prisma.toolExecution.findMany({
            where: { sessionId: { in: sessionIds } },
            select: {
              id: true,
              status: true,
              duration: true,
              createdAt: true,
              capability: { select: { name: true } },
            },
            orderBy: { createdAt: 'desc' },
          })
        : [];

    // Aggregate totals
    const total = executions.length;
    const successCount = executions.filter((e) => e.status === 'SUCCESS').length;
    const failedCount = executions.filter((e) => e.status === 'FAILED').length;
    const durations = executions
      .map((e) => e.duration)
      .filter((d): d is number => d !== null && d !== undefined);
    const avgDuration =
      durations.length > 0
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : 0;

    // Build daily trend: { date: 'YYYY-MM-DD', total, success, failed }
    const trendMap = new Map<string, { total: number; success: number; failed: number }>();

    // Pre-fill all days in range with zeroes so chart has continuous axis
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      trendMap.set(key, { total: 0, success: 0, failed: 0 });
    }

    for (const exec of executions) {
      const key = exec.createdAt.toISOString().slice(0, 10);
      const entry = trendMap.get(key);
      if (entry) {
        entry.total += 1;
        if (exec.status === 'SUCCESS') entry.success += 1;
        if (exec.status === 'FAILED') entry.failed += 1;
      }
    }

    const trend = Array.from(trendMap.entries()).map(([date, counts]) => ({
      date,
      ...counts,
    }));

    // Recent executions log (last 10)
    const recentLog = executions.slice(0, 10).map((e) => ({
      id: e.id,
      toolName: e.capability?.name ?? 'unknown',
      status: e.status,
      duration: e.duration,
      createdAt: e.createdAt.toISOString(),
    }));

    return {
      period: { days, startDate: startDate.toISOString() },
      summary: { total, successCount, failedCount, avgDuration },
      trend,
      recentLog,
    };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────────────────────────────────────────

  private defaultInclude() {
    return {
      bindings: {
        include: {
          capability: { select: { id: true, name: true, type: true } },
        },
        orderBy: { priority: 'asc' as const },
      },
    };
  }

  private async validateCapabilitiesApproved(capabilityIds: string[]) {
    const capabilities = await this.prisma.capability.findMany({
      where: { id: { in: capabilityIds } },
      select: { id: true, status: true, name: true },
    });

    if (capabilities.length !== capabilityIds.length) {
      const foundIds = new Set(capabilities.map((c) => c.id));
      const missing = capabilityIds.filter((id) => !foundIds.has(id));
      throw new NotFoundException(`Capabilities not found: ${missing.join(', ')}`);
    }

    const notApproved = capabilities.filter((c) => c.status !== 'APPROVED');
    if (notApproved.length > 0) {
      const names = notApproved.map((c) => `${c.name} (${c.status})`).join(', ');
      throw new BadRequestException(`Capabilities not approved: ${names}`);
    }
  }
}
