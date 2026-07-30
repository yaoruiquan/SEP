import { Injectable, ForbiddenException, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingService } from '../setting/setting.service';
import { SETTING_KEYS, calculateModelCost } from 'shared';
import type { ChatCompletionRequest, ChatCompletionUsage } from 'shared';

const DEFAULT_USD_RATE = 7.2;

@Injectable()
export class GatewayService {
  private readonly logger = new Logger(GatewayService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private settingService: SettingService,
  ) {}

  /**
   * 验证实例令牌 + 检查授权和余额
   * @returns { enterpriseId, instanceId, memberId, modelWhitelist }
   */
  async validateAndAuthorize(claims: {
    sub: string;
    enterpriseId: string;
    instanceId: string;
    memberId: string;
  }): Promise<{ enterpriseId: string; instanceId: string; memberId: string; allowedModels: string[] }> {
    const { enterpriseId, instanceId, memberId } = claims;

    // 1. 检查实例状态
    const instance = await this.prisma.employeeInstance.findFirst({
      where: { id: instanceId, enterpriseId, status: 'ACTIVE' },
    });
    if (!instance) {
      throw new ForbiddenException('实例不存在、已停用或不属于该企业');
    }

    // 2. 检查授权
    const now = new Date();
    const grant = await this.prisma.employeeGrant.findFirst({
      where: {
        instanceId,
        AND: [
          {
            OR: [
              { memberId },
              { department: { members: { some: { id: memberId } } } },
            ],
          },
          {
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
        ],
      },
    });
    if (!grant) {
      throw new ForbiddenException('无该实例的使用授权或授权已过期');
    }

    // 3. 检查企业余额（允许小额透支）
    const computeAccount = await this.prisma.computeAccount.findUnique({
      where: { enterpriseId },
      select: { balance: true },
    });
    if (!computeAccount || computeAccount.balance <= 0) {
      throw new ForbiddenException('企业算力余额不足，请联系管理员充值');
    }

    // 4. 获取模型白名单（从 PlatformModel）
    const models = await this.prisma.platformModel.findMany({
      where: { enabled: true },
      select: { id: true },
    });
    const allowedModels = models.map((m) => m.id);

    return { enterpriseId, instanceId, memberId, allowedModels };
  }

  /**
   * 获取 sub2api 配置
   */
  async getSub2ApiConfig(): Promise<{ baseUrl: string; apiKey: string; defaultModel: string }> {
    const baseUrl =
      (await this.settingService.getEffectiveValue(SETTING_KEYS.SUB2API_BASE_URL)) ||
      'https://longdaoai.cn/v1';
    const apiKey =
      (await this.settingService.getEffectiveValue(SETTING_KEYS.SUB2API_API_KEY)) || '';
    const defaultModel =
      (await this.settingService.getEffectiveValue(SETTING_KEYS.SUB2API_DEFAULT_MODEL)) ||
      'gpt-3.5-turbo';

    if (!apiKey) {
      throw new BadRequestException('sub2api API Key 未配置');
    }

    return { baseUrl, apiKey, defaultModel };
  }

  /**
   * 记账（后台异步，失败只记日志）
   */
  async recordTransaction(params: {
    enterpriseId: string;
    instanceId: string;
    memberId: string;
    modelId: string;
    usage: ChatCompletionUsage;
  }): Promise<void> {
    try {
      const rateStr = await this.settingService.getEffectiveValue(SETTING_KEYS.USD_TO_CNY_RATE);
      const usdRate = rateStr ? parseFloat(rateStr) : DEFAULT_USD_RATE;

      const cost = calculateModelCost(
        params.modelId,
        params.usage.prompt_tokens,
        params.usage.completion_tokens,
        usdRate,
      );

      // 获取企业的算力账户
      const computeAccount = await this.prisma.computeAccount.findUnique({
        where: { enterpriseId: params.enterpriseId },
      });

      if (!computeAccount) {
        this.logger.error(`企业 ${params.enterpriseId} 没有算力账户，无法记账`);
        return;
      }

      await this.prisma.$transaction([
        // 写入交易记录
        this.prisma.computeTransaction.create({
          data: {
            accountId: computeAccount.id,
            amount: -cost,
            type: 'CONSUME',
            description: `模型调用：${params.modelId}`,
            metadata: {
              instanceId: params.instanceId,
              memberId: params.memberId,
              usage: params.usage as any,
            },
          },
        }),
        // 扣减余额
        this.prisma.computeAccount.update({
          where: { id: computeAccount.id },
          data: { balance: { decrement: cost } },
        }),
      ]);

      this.logger.log(`记账成功：instanceId=${params.instanceId}, cost=${cost.toFixed(4)} CNY`);
    } catch (error) {
      this.logger.error(`记账失败：${error.message}`, error.stack);
      // 不抛错，允许继续
    }
  }
}
