import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { ModelService } from '../model/model.service';
import { ConversationCreateDto, ConversationUpdateDto } from 'shared';

@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionService: SubscriptionService,
    private readonly modelService: ModelService,
  ) {}

  async create(userId: string, dto: ConversationCreateDto) {
    // 验证 DigitalEmployee 存在
    const employee = await this.prisma.digitalEmployee.findUnique({
      where: { id: dto.employeeId },
      select: { id: true, name: true },
    });
    if (!employee) {
      throw new NotFoundException(`Digital employee ${dto.employeeId} not found`);
    }

    // 必须持有有效订阅
    await this.subscriptionService.assertActiveSubscription(userId, dto.employeeId);

    const session = await this.prisma.conversationSession.create({
      data: {
        userId,
        employeeId: dto.employeeId,
        title: dto.title ?? null,
      },
      select: {
        id: true,
        title: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        employee: { select: { id: true, name: true, avatar: true } },
      },
    });

    this.logger.log(`Session created: ${session.id} by user ${userId}`);
    return session;
  }

  async findAll(userId: string) {
    return this.prisma.conversationSession.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        title: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        employee: { select: { id: true, name: true, avatar: true } },
        _count: { select: { messages: true } },
      },
    });
  }

  async findOne(sessionId: string, userId: string) {
    const session = await this.prisma.conversationSession.findUnique({
      where: { id: sessionId },
      include: {
        employee: { select: { id: true, name: true, avatar: true, modelId: true } },
        messages: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            role: true,
            content: true,
            toolCalls: true,
            createdAt: true,
          },
        },
      },
    });

    if (!session) throw new NotFoundException(`Session ${sessionId} not found`);
    if (session.userId !== userId) throw new ForbiddenException();

    return session;
  }

  async update(sessionId: string, userId: string, dto: ConversationUpdateDto) {
    await this.assertOwner(sessionId, userId);

    return this.prisma.conversationSession.update({
      where: { id: sessionId },
      data: { title: dto.title },
      select: { id: true, title: true, updatedAt: true },
    });
  }

  async switchModel(sessionId: string, userId: string, modelId: string) {
    await this.assertOwner(sessionId, userId);

    // 只允许切到平台已启用的模型（防止绕过白名单调用未开放模型）
    if (modelId && !(await this.modelService.isEnabled(modelId))) {
      throw new BadRequestException(`模型 ${modelId} 未开放使用`);
    }

    return this.prisma.conversationSession.update({
      where: { id: sessionId },
      data: { modelId: modelId || null }, // 空 = 回退员工默认模型
      select: { id: true, modelId: true, updatedAt: true },
    });
  }

  async remove(sessionId: string, userId: string) {
    await this.assertOwner(sessionId, userId);

    await this.prisma.conversationSession.delete({ where: { id: sessionId } });
    this.logger.log(`Session deleted: ${sessionId}`);
  }

  /**
   * 首条消息后自动生成标题（仅 title 为 null 时设置，重命名后不覆盖）
   */
  async autoGenerateTitle(sessionId: string, firstUserMessage: string): Promise<void> {
    const session = await this.prisma.conversationSession.findUnique({
      where: { id: sessionId },
      select: { title: true, _count: { select: { messages: true } } },
    });

    if (!session) return;

    // 只在 title 从未设置（null），且消息数 ≤ 2（用户+AI 第一轮）时生成
    if (session.title === null && session._count.messages <= 2) {
      const autoTitle = firstUserMessage.slice(0, 20).trim();
      await this.prisma.conversationSession.update({
        where: { id: sessionId },
        data: { title: autoTitle },
      });
    }
  }

  private async assertOwner(sessionId: string, userId: string) {
    const session = await this.prisma.conversationSession.findUnique({
      where: { id: sessionId },
      select: { userId: true },
    });

    if (!session) throw new NotFoundException(`Session ${sessionId} not found`);
    if (session.userId !== userId) throw new ForbiddenException();
  }
}
