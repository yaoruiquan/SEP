import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { EnterpriseModelConfigService } from '../enterprise-model-config/enterprise-model-config.service';
import type { ChatCompletionRequest } from 'shared';

export interface GatewayModelIdentity {
  sub: string;
  enterpriseId: string;
  memberId: string;
  subscriptionId?: string;
}

export interface GatewayModelPolicy {
  allowedModels: string[];
  defaultModel: string;
  allowUserSwitchModel: boolean;
  departmentId: string | null;
}

@Injectable()
export class GatewayModelPolicyService {
  constructor(
    private readonly modelConfig: EnterpriseModelConfigService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async prepare(identity: GatewayModelIdentity, request: ChatCompletionRequest): Promise<{
    allowedModels: string[];
    request: ChatCompletionRequest;
    inputBytes: number;
  }> {
    const policy = await this.resolvePolicy(identity);
    return { allowedModels: policy.allowedModels, ...await this.validateResources(request, policy) };
  }

  async resolvePolicy(identity: GatewayModelIdentity): Promise<GatewayModelPolicy> {
    const member = await this.prisma.enterpriseMember.findFirst({
      where: { id: identity.memberId, enterpriseId: identity.enterpriseId, userId: identity.sub },
      select: { departmentId: true },
    });
    if (!member) {
      throw new ForbiddenException('成员不属于当前用户或企业');
    }

    let employeeTemplateModel: string | null = null;
    if (identity.subscriptionId) {
      const subscription = await this.prisma.subscription.findFirst({
        where: { id: identity.subscriptionId, enterpriseId: identity.enterpriseId },
        select: { employee: { select: { modelId: true } } },
      });
      if (!subscription) throw new ForbiddenException('订阅不属于当前企业');
      employeeTemplateModel = subscription.employee.modelId;
    }

    const effective = await this.modelConfig.resolveEffectiveModel({
      userId: identity.sub,
      enterpriseId: identity.enterpriseId,
      departmentId: member.departmentId ?? undefined,
      subscriptionId: identity.subscriptionId,
      employeeTemplateModel,
      restrictToAvailableModels: true,
    });
    const allowedModels = effective.allowUserSwitchModel
      ? effective.allowedChatModels
      : effective.allowedChatModels.filter((id) => id === effective.chatModel);
    if (!effective.allowUserSwitchModel && allowedModels.length === 0) {
      throw new BadRequestException({
        error: {
          code: 'MODEL_POLICY_DEFAULT_INVALID',
          message: '强制默认模型未启用、已下架或不在企业与部门允许范围内，请联系管理员',
          type: 'invalid_request_error', param: 'model',
        },
      });
    }
    return {
      allowedModels,
      defaultModel: effective.chatModel,
      allowUserSwitchModel: effective.allowUserSwitchModel,
      departmentId: member.departmentId,
    };
  }

  /** 返回副本供上游转发；调用方必须使用 request，才能应用默认输出预算。 */
  async validateResources(request: ChatCompletionRequest, policy: GatewayModelPolicy): Promise<{
    request: ChatCompletionRequest;
    inputBytes: number;
  }> {
    if (!policy.allowedModels.includes(request.model)) {
      throw new ForbiddenException('该模型不在当前成员允许范围内');
    }
    const model = await this.prisma.platformModel.findFirst({
      where: { modelId: request.model, enabled: true, isStale: false },
      select: { maxOutputTokens: true, supportedFeatures: true },
    });
    if (!model) throw new BadRequestException('该模型未启用或已下架');

    const features = model.supportedFeatures as Record<string, unknown> | null;
    const usesTools = Boolean(request.tools?.length) ||
      (request.tool_choice !== undefined && request.tool_choice !== 'none') ||
      request.messages.some((message) => message.role === 'tool' || message.tool_calls?.length);
    if (features?.functionCalling === false && usesTools) {
      throw new BadRequestException('该模型不支持 functionCalling');
    }
    if (features?.streaming === false && request.stream) {
      throw new BadRequestException('该模型不支持 streaming');
    }

    const cap = model.maxOutputTokens ?? null;
    if (cap !== null && (!Number.isSafeInteger(cap) || cap <= 0)) {
      throw new BadRequestException('模型 maxOutputTokens 配置无效');
    }
    const defaultMaxTokens = this.positiveConfig('GATEWAY_DEFAULT_MAX_TOKENS', 4096);
    const effectiveCap = cap ?? defaultMaxTokens;
    const maxTokens = request.max_tokens ?? Math.min(defaultMaxTokens, effectiveCap);
    if (!Number.isSafeInteger(maxTokens) || maxTokens <= 0 || maxTokens > effectiveCap) {
      throw new BadRequestException('max_tokens 必须为正整数且不能超过模型或平台输出上限');
    }
    const normalized = { ...request, max_tokens: maxTokens };
    let serialized: string;
    try {
      serialized = JSON.stringify(normalized);
    } catch {
      throw new BadRequestException('请求无法序列化');
    }
    // UTF-8 字节限制不是 context token 校验，也不用于计费。
    const inputBytes = Buffer.byteLength(serialized, 'utf8');
    if (inputBytes > this.positiveConfig('GATEWAY_MAX_REQUEST_BYTES', 4 * 1024 * 1024)) {
      throw new PayloadTooLargeException('模型请求超过序列化资源上限');
    }
    return { request: normalized, inputBytes };
  }

  private positiveConfig(key: string, fallback: number): number {
    const raw = this.config.get<string | number>(key) ?? fallback;
    const value = typeof raw === 'number' || /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isSafeInteger(value) || value <= 0 || value > 2147483647) {
      throw new InternalServerErrorException(`${key} must be an integer between 1 and 2147483647`);
    }
    return value;
  }
}
