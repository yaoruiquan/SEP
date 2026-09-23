import { Injectable, ForbiddenException, Logger, BadRequestException, BadGatewayException, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingService } from '../setting/setting.service';
import { DEFAULT_MODEL_ID, SETTING_KEYS } from 'shared';
import type { ChatCompletionRequest, ChatCompletionUsage } from 'shared';
import { ComputeCreditService } from '../compute-credit/compute-credit.service';

@Injectable()
export class GatewayService {
  private readonly logger = new Logger(GatewayService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private settingService: SettingService,
    private computeCreditService: ComputeCreditService,
  ) {}

  /**
   * 验证订阅令牌 + 检查授权和余额
   * @returns { enterpriseId, subscriptionId, memberId, employeeId, modelWhitelist }
   */
  async validateAndAuthorize(claims: {
    sub: string;
    enterpriseId: string;
    subscriptionId: string;
    memberId: string;
  }): Promise<{
    enterpriseId: string;
    subscriptionId: string;
    memberId: string;
    employeeId: string;
    allowedModels: string[];
  }> {
    const { enterpriseId, subscriptionId, memberId } = claims;

    // 1. 检查订阅状态
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        id: subscriptionId,
        enterpriseId,
        status: 'ACTIVE',
        OR: [{ endDate: null }, { endDate: { gt: new Date() } }],
      },
      select: { employeeId: true },
    });
    if (!subscription) {
      throw new ForbiddenException('订阅不存在、已停用或不属于该企业');
    }

    // 2. 检查授权
    const now = new Date();
    const grant = await this.prisma.employeeGrant.findFirst({
      where: {
        subscriptionId,
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
      throw new ForbiddenException('无该订阅的使用授权或授权已过期');
    }

    // 3. 使用统一算力账本检查余额。不要读取已废弃的 ComputeAccount，
    // 否则 Web 展示的钱包余额与客户端网关会继续使用两套账本。
    const balance = await this.computeCreditService.checkBalanceBeforeConversation(
      enterpriseId,
      subscriptionId,
      claims.sub,
    );
    if (!balance.allowed) {
      throw new ForbiddenException(balance.reason || '企业算力余额不足，请联系管理员充值');
    }

    // 4. 获取模型白名单（从 PlatformModel）
    const [models, modelConfig] = await Promise.all([
      this.prisma.platformModel.findMany({ where: { enabled: true }, select: { modelId: true } }),
      this.prisma.enterpriseModelConfig.findUnique({ where: { enterpriseId }, select: { allowedChatModels: true } }),
    ]);
    const enabledModels = models.map((m) => m.modelId);
    const allowedModels = modelConfig?.allowedChatModels?.length
      ? enabledModels.filter((id) => modelConfig.allowedChatModels.includes(id)) : enabledModels;

    return { enterpriseId, subscriptionId, memberId, employeeId: subscription.employeeId, allowedModels };
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
    // 兜底值必须与 DEFAULT_MODEL_ID 一致。这里原来写死 'gpt-3.5-turbo'，
    // 而中转早就不提供任何 gpt-* 模型（实测 /v1/models 只有 gemini-*），
    // 系统设置一旦为空，客户端网关就会拿一个必然 404 的模型去请求。
    const defaultModel =
      (await this.settingService.getEffectiveValue(SETTING_KEYS.SUB2API_DEFAULT_MODEL)) ||
      DEFAULT_MODEL_ID;

    if (!apiKey) {
      throw new BadRequestException('sub2api API Key 未配置');
    }

    return { baseUrl, apiKey, defaultModel };
  }

  /** 转发已校验的 OpenAI 兼容请求，并保留上游错误状态与字段定位信息。 */
  async forwardChatCompletion(dto: ChatCompletionRequest): Promise<Response> {
    const { baseUrl, apiKey } = await this.getSub2ApiConfig();
    let response: Response;
    try {
      response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(dto),
        signal: AbortSignal.timeout(30000),
      });
    } catch (error) {
      const message = error?.name === 'TimeoutError' || error?.name === 'AbortError'
        ? 'sub2api 请求超时（30s）'
        : '无法连接 sub2api';
      throw new BadGatewayException({
        error: { message, type: 'api_error', code: 'UPSTREAM_UNAVAILABLE', param: null },
      });
    }

    if (!response.ok) {
      // 不把 HTML 代理错误页或整个上游响应直接暴露给客户端。
      const body = await response.json().catch(() => null);
      const error = body?.error;
      throw new HttpException({
        error: {
          message: typeof error?.message === 'string' && error.message
            ? error.message : `sub2api 请求失败（HTTP ${response.status}）`,
          type: typeof error?.type === 'string' ? error.type : response.status >= 500 ? 'api_error' : 'invalid_request_error',
          code: typeof error?.code === 'string' ? error.code : 'UPSTREAM_ERROR',
          param: typeof error?.param === 'string' ? error.param : null,
        },
      }, response.status);
    }
    return response;
  }

  /** 记账到统一算力账本，并由 ComputeUsageRecord 的幂等键防止重复扣费。 */
  async recordTransaction(params: {
    enterpriseId: string;
    subscriptionId: string;
    memberId: string;
    employeeId: string;
    userId?: string;
    sessionId: string;
    messageId: string;
    modelId: string;
    usage: ChatCompletionUsage;
  }): Promise<void> {
    try {
      const result = await this.computeCreditService.chargeUsage({
        enterpriseId: params.enterpriseId,
        subscriptionId: params.subscriptionId,
        employeeId: params.employeeId,
        userId: params.userId,
        sessionId: params.sessionId,
        messageId: params.messageId,
        modelId: params.modelId,
        inputTokens: params.usage.prompt_tokens,
        outputTokens: params.usage.completion_tokens,
      });

      this.logger.log(
        `统一账本记账成功：subscriptionId=${params.subscriptionId}, ` +
        `usageRecordId=${result.usageRecordId}, alreadyCharged=${result.alreadyCharged}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`统一账本记账失败：${message}`, stack);
    }
  }
}
