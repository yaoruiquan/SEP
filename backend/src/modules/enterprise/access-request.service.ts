import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestStatus } from '@prisma/client';

@Injectable()
export class AccessRequestService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 创建访问申请（普通成员申请使用跨部门员工）
   */
  async create(
    userId: string,
    data: {
      instanceId: string;
      reason?: string;
      requestedDays?: number;
    },
  ) {
    // 获取申请人的成员身份
    const member = await this.prisma.enterpriseMember.findFirst({
      where: { userId },
      include: { enterprise: true },
    });

    if (!member) {
      throw new ForbiddenException('您不属于任何企业');
    }

    // 检查实例是否存在且属于同一企业
    const instance = await this.prisma.employeeInstance.findUnique({
      where: { id: data.instanceId },
      include: { template: true },
    });

    if (!instance) {
      throw new NotFoundException('员工实例不存在');
    }

    if (instance.enterpriseId !== member.enterpriseId) {
      throw new ForbiddenException('不能申请其他企业的员工');
    }

    // 检查是否已有权限
    const existingGrant = await this.prisma.employeeGrant.findFirst({
      where: {
        instanceId: data.instanceId,
        memberId: member.id,
      },
    });

    if (existingGrant) {
      throw new BadRequestException('您已经拥有该员工的使用权限');
    }

    // 检查是否有待审批的申请
    const pendingRequest = await this.prisma.accessRequest.findFirst({
      where: {
        instanceId: data.instanceId,
        requesterId: member.id,
        status: 'PENDING',
      },
    });

    if (pendingRequest) {
      throw new BadRequestException('您已有待审批的申请，请勿重复提交');
    }

    // 创建申请
    return this.prisma.accessRequest.create({
      data: {
        enterpriseId: member.enterpriseId,
        requesterId: member.id,
        instanceId: data.instanceId,
        reason: data.reason,
        requestedDays: data.requestedDays,
        status: 'PENDING',
      },
      include: {
        requester: {
          include: {
            user: { select: { name: true, email: true } },
            department: { select: { name: true } },
          },
        },
        instance: {
          include: {
            template: { select: { name: true } },
          },
        },
      },
    });
  }

  /**
   * 获取待审批列表（企业管理员/部门负责人可见）
   */
  async listPending(userId: string) {
    // 获取用户的成员身份
    const member = await this.prisma.enterpriseMember.findFirst({
      where: { userId },
      include: { enterprise: true },
    });

    if (!member) {
      throw new ForbiddenException('您不属于任何企业');
    }

    // 只有管理员和部门负责人能查看
    if (member.role === 'MEMBER') {
      throw new ForbiddenException('无权查看审批列表');
    }

    return this.prisma.accessRequest.findMany({
      where: {
        enterpriseId: member.enterpriseId,
        status: 'PENDING',
      },
      include: {
        requester: {
          include: {
            user: { select: { id: true, name: true, email: true, avatar: true } },
            department: { select: { id: true, name: true } },
          },
        },
        instance: {
          include: {
            template: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * 批准申请
   */
  async approve(userId: string, requestId: string, reviewNote?: string) {
    const request = await this.prisma.accessRequest.findUnique({
      where: { id: requestId },
      include: {
        requester: { include: { enterprise: true } },
        instance: true,
      },
    });

    if (!request) {
      throw new NotFoundException('申请不存在');
    }

    // 检查审批权限
    const member = await this.prisma.enterpriseMember.findFirst({
      where: {
        userId,
        enterpriseId: request.enterpriseId,
      },
    });

    if (!member || member.role === 'MEMBER') {
      throw new ForbiddenException('无权审批');
    }

    if (request.status !== 'PENDING') {
      throw new BadRequestException('该申请已被处理');
    }

    // 申请人已离职（requesterId 被 SetNull）。
    // 成员移除时会把 PENDING 申请置为 CANCELED，正常走不到这里；
    // 这道判断是兜底 —— 少了它，下面会建出一条 memberId 为空、
    // 既不属于任何人也不属于任何部门的悬空授权。
    if (!request.requesterId) {
      throw new BadRequestException('申请人已不在本企业，无法批准');
    }

    // 计算授权过期时间
    const expiresAt = request.requestedDays
      ? new Date(Date.now() + request.requestedDays * 24 * 60 * 60 * 1000)
      : undefined;

    // 使用事务：更新申请状态 + 创建授权
    return this.prisma.$transaction(async (tx) => {
      // 更新申请状态
      const updatedRequest = await tx.accessRequest.update({
        where: { id: requestId },
        data: {
          status: 'APPROVED',
          reviewerId: userId,
          reviewNote,
          reviewedAt: new Date(),
        },
        include: {
          requester: {
            include: {
              user: { select: { name: true, email: true } },
              department: { select: { name: true } },
            },
          },
          instance: {
            include: {
              template: { select: { name: true } },
            },
          },
        },
      });

      // 创建授权
      await tx.employeeGrant.create({
        data: {
          instanceId: request.instanceId,
          memberId: request.requesterId,
          expiresAt,
        },
      });

      return updatedRequest;
    });
  }

  /**
   * 拒绝申请
   */
  async reject(userId: string, requestId: string, reviewNote?: string) {
    const request = await this.prisma.accessRequest.findUnique({
      where: { id: requestId },
      include: {
        requester: { include: { enterprise: true } },
      },
    });

    if (!request) {
      throw new NotFoundException('申请不存在');
    }

    // 检查审批权限
    const member = await this.prisma.enterpriseMember.findFirst({
      where: {
        userId,
        enterpriseId: request.enterpriseId,
      },
    });

    if (!member || member.role === 'MEMBER') {
      throw new ForbiddenException('无权审批');
    }

    if (request.status !== 'PENDING') {
      throw new BadRequestException('该申请已被处理');
    }

    return this.prisma.accessRequest.update({
      where: { id: requestId },
      data: {
        status: 'REJECTED',
        reviewerId: userId,
        reviewNote,
        reviewedAt: new Date(),
      },
      include: {
        requester: {
          include: {
            user: { select: { name: true, email: true } },
            department: { select: { name: true } },
          },
        },
        instance: {
          include: {
            template: { select: { name: true } },
          },
        },
      },
    });
  }

  /**
   * 获取我的申请历史
   */
  async myRequests(userId: string) {
    const member = await this.prisma.enterpriseMember.findFirst({
      where: { userId },
    });

    if (!member) {
      throw new ForbiddenException('您不属于任何企业');
    }

    return this.prisma.accessRequest.findMany({
      where: { requesterId: member.id },
      include: {
        instance: {
          include: {
            template: { select: { id: true, name: true } },
          },
        },
        reviewer: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
