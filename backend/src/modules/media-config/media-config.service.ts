import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MediaModelProfile, Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingService } from '../setting/setting.service';
import { EnterpriseContextService } from '../enterprise/enterprise-context.service';
import { Sub2apiImageAdapter } from '../media-gateway/sub2api-image.adapter';
import { IMAGE_MODEL_SIZES, isSupportedImageModel } from '../media-gateway/image-model-contract';
import {
  CreateMediaProfileDto,
  MediaCapabilitiesSchema,
  MediaPolicy,
  MediaPolicySchema,
  MediaProfile,
  MediaProfileSchema,
  MediaRuntime,
  MediaModelDiscovery,
  MediaProfileVerification,
  MediaRealQuoteRequest,
  SETTING_KEYS,
  UpdateMediaConnectionDto,
  UpdateMediaPolicyDto,
  UpdateMediaProfileDto,
  VerifyMediaProfileDto,
} from 'shared';

@Injectable()
export class MediaConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settingService: SettingService,
    private readonly enterpriseContext: EnterpriseContextService,
    @Optional() private readonly config?: ConfigService,
    @Optional() private readonly imageAdapter?: Sub2apiImageAdapter,
  ) {}

  private profileView(row: MediaModelProfile): MediaProfile {
    const result = MediaProfileSchema.safeParse({
      profileId: row.profileId, kind: row.kind, displayName: row.displayName,
      modelId: row.modelId, configVersion: row.configVersion,
      operations: row.operations, executionMode: row.executionMode,
      capabilities: row.capabilities, enabled: row.enabled, verified: row.verified,
    });
    if (!result.success) throw new ServiceUnavailableException('媒体 Profile 配置无效，请联系平台管理员');
    return result.data;
  }

  private parsePolicy(value: unknown): MediaPolicy {
    const parsed = MediaPolicySchema.safeParse(value ?? {});
    return parsed.success ? parsed.data : MediaPolicySchema.parse({});
  }

  async listProfiles(): Promise<MediaProfile[]> {
    const rows = await this.prisma.mediaModelProfile.findMany({ orderBy: { createdAt: 'asc' } });
    return rows.map((row) => this.profileView(row));
  }

  async createProfile(dto: CreateMediaProfileDto): Promise<MediaProfile> {
    if (dto.enabled) throw new BadRequestException('媒体 Profile 必须先通过配置校验后才能启用');
    const capabilities = MediaCapabilitiesSchema.safeParse(dto.capabilities);
    if (!capabilities.success) throw new BadRequestException('媒体能力配置无效');
    try {
      const created = await this.prisma.mediaModelProfile.create({
        data: {
          profileId: dto.profileId,
          kind: dto.kind,
          displayName: dto.displayName,
          modelId: dto.modelId,
          executionMode: dto.executionMode,
          enabled: dto.enabled,
          operations: [...new Set(dto.operations)],
          capabilities: capabilities.data,
          configVersion: `cfg_${randomUUID()}`,
          verified: false,
        },
      });
      return this.profileView(created);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('媒体 Profile ID 已存在');
      }
      throw error;
    }
  }

  async updateProfile(profileId: string, dto: UpdateMediaProfileDto): Promise<MediaProfile> {
    const row = await this.prisma.mediaModelProfile.findUnique({ where: { profileId } });
    if (!row) throw new NotFoundException('媒体 Profile 不存在');
    const current = this.profileView(row);
    if (dto.expectedConfigVersion !== current.configVersion) {
      throw new ConflictException('媒体配置已更新，请重新加载后保存');
    }
    const { expectedConfigVersion: _version, capabilities, ...changes } = dto;
    const parsed = MediaProfileSchema.safeParse({
      ...current, ...changes,
      operations: [...new Set(changes.operations ?? current.operations)],
      capabilities: { ...current.capabilities, ...capabilities },
    });
    if (!parsed.success) throw new BadRequestException('媒体 Profile 配置无效');
    const next = parsed.data;
    if (next.enabled && !current.verified) throw new BadRequestException('媒体 Profile 必须先通过配置校验后才能启用');
    if (next.operations.includes('edit') && !next.capabilities.supportsReferenceImage) {
      throw new BadRequestException('编辑能力必须支持参考图');
    }
    const contractChanged = !isDeepStrictEqual(
      [current.modelId, current.operations, current.executionMode, current.capabilities],
      [next.modelId, next.operations, next.executionMode, next.capabilities],
    );
    if (isDeepStrictEqual(current, next)) return current;
    const updated = await this.prisma.mediaModelProfile.updateMany({
      where: { profileId, configVersion: current.configVersion },
      data: {
        displayName: next.displayName, modelId: next.modelId,
        operations: next.operations, executionMode: next.executionMode,
        capabilities: next.capabilities, enabled: next.enabled,
        configVersion: `cfg_${randomUUID()}`,
        verified: contractChanged ? false : current.verified,
      },
    });
    if (!updated.count) throw new ConflictException('媒体配置已更新，请重新加载后保存');
    const saved = await this.prisma.mediaModelProfile.findUnique({ where: { profileId } });
    if (!saved) throw new NotFoundException('媒体 Profile 不存在');
    return this.profileView(saved);
  }

  async getConnection() {
    const [baseUrl, apiKey] = await Promise.all([
      this.settingService.getEffectiveValue(SETTING_KEYS.MEDIA_BASE_URL),
      this.settingService.getEffectiveValue(SETTING_KEYS.MEDIA_API_KEY),
    ]);
    return {
      configured: Boolean(baseUrl?.trim() && apiKey?.trim()),
      baseUrl: baseUrl ?? '', apiKeyConfigured: Boolean(apiKey?.trim()),
    };
  }

  async updateConnection(dto: UpdateMediaConnectionDto) {
    await this.revokeProfileVerification();
    await this.settingService.updateMediaConnection(dto);
    // The second revocation closes a verification that raced with connection mutation.
    await this.revokeProfileVerification();
    return this.getConnection();
  }

  private async revokeProfileVerification() {
    await this.prisma.mediaModelProfile.updateMany({
      data: { verified: false, configVersion: `cfg_${randomUUID()}` },
    });
  }

  async discoverModels(): Promise<MediaModelDiscovery> {
    if (!this.imageAdapter) throw new ServiceUnavailableException('媒体模型检测暂不可用');
    const models = await this.imageAdapter.discoverModels();
    return {
      checkedAt: new Date().toISOString(),
      models: models.map(model => {
        const compatible = isSupportedImageModel(model.modelId);
        return {
          ...model, compatible,
          reason: compatible ? null : '当前图片适配器尚未支持此模型协议',
          suggested: compatible ? {
            operations: ['generate', 'edit'], executionMode: 'sync-response',
            capabilities: { supportsReferenceImage: true, maxOutputs: 4, sizes: [...IMAGE_MODEL_SIZES] },
          } : null,
        };
      }),
    };
  }

  async verifyProfile(profileId: string, dto: VerifyMediaProfileDto): Promise<MediaProfileVerification> {
    if (!this.imageAdapter) throw new ServiceUnavailableException('媒体配置校验暂不可用');
    const row = await this.prisma.mediaModelProfile.findUnique({ where: { profileId } });
    if (!row) throw new NotFoundException('媒体 Profile 不存在');
    const profile = this.profileView(row);
    if (profile.configVersion !== dto.expectedConfigVersion) throw new ConflictException('媒体配置已更新，请重新加载后校验');
    if (!isSupportedImageModel(profile.modelId) || profile.executionMode !== 'sync-response' ||
      profile.capabilities.maxOutputs > 4 || profile.capabilities.sizes.some(size => !(IMAGE_MODEL_SIZES as readonly string[]).includes(size)) ||
      (profile.operations.includes('edit') && !profile.capabilities.supportsReferenceImage)) {
      throw new BadRequestException('当前模型或参数超出图片适配器支持范围');
    }
    try {
      const discovered = await this.imageAdapter.discoverModels();
      if (!discovered.some(model => model.modelId === profile.modelId)) throw new BadRequestException('媒体连接的模型目录中不存在此模型');
      const checks: MediaRealQuoteRequest[] = [];
      for (const operation of [...new Set(profile.operations)]) {
        for (const size of [...new Set(profile.capabilities.sizes)]) {
          for (const quality of ['low', 'medium', 'high'] as const) {
            for (let count = 1; count <= profile.capabilities.maxOutputs; count++) {
              checks.push({ profileId, configVersion: profile.configVersion, operation,
                creativeBrief: 'Media configuration preflight', referenceIds: [],
                parameters: { size: size as MediaRealQuoteRequest['parameters']['size'], count, quality } });
            }
          }
        }
      }
      // Pricing is read-only. Bound concurrency and never call the execution endpoint here.
      for (let offset = 0; offset < checks.length; offset += 3) {
        await Promise.all(checks.slice(offset, offset + 3).map(async input => {
          const price = await this.imageAdapter!.pricing(input, profile.modelId);
          if (!price.amount_usd || new Decimal(price.amount_usd).lte(0)) throw new ServiceUnavailableException('模型没有可用的正金额报价');
        }));
      }
    } catch (error) {
      await this.prisma.mediaModelProfile.updateMany({
        where: { profileId, configVersion: profile.configVersion, verified: true },
        data: { verified: false, configVersion: `cfg_${randomUUID()}` },
      });
      throw error;
    }
    const updated = await this.prisma.mediaModelProfile.updateMany({
      where: { profileId, configVersion: profile.configVersion },
      data: { verified: true, configVersion: `cfg_${randomUUID()}` },
    });
    if (!updated.count) throw new ConflictException('媒体连接或配置在校验期间已变更，请重新加载后重试');
    const saved = await this.prisma.mediaModelProfile.findUnique({ where: { profileId } });
    if (!saved) throw new NotFoundException('媒体 Profile 已被删除');
    return { profile: this.profileView(saved), checkedAt: new Date().toISOString(), executionTested: false };
  }

  private async availableProfiles() {
    if (!(await this.getConnection()).configured) return [];
    const rows = await this.prisma.mediaModelProfile.findMany({
      where: { kind: 'image', enabled: true, verified: true }, orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => this.profileView(row));
  }

  private async realConnectionUsable(): Promise<boolean> {
    const [baseUrl, apiKey] = await Promise.all([
      this.settingService.getEffectiveValue(SETTING_KEYS.MEDIA_BASE_URL),
      this.settingService.getEffectiveValue(SETTING_KEYS.MEDIA_API_KEY),
    ]);
    if (!baseUrl?.trim() || !apiKey?.trim() || /[\r\n]/.test(apiKey)) return false;
    try {
      const url = new URL(baseUrl.trim());
      return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
    } catch {
      return false;
    }
  }

  private async realRuntimeEnabled(): Promise<boolean> {
    if (this.config?.get<string>('MEDIA_GATEWAY_REAL_ENABLED') !== 'true') return false;
    return this.realConnectionUsable();
  }

  async getAvailableProfiles(userId: string) {
    await this.enterpriseContext.resolve(userId);
    return (await this.availableProfiles()).map(({ modelId: _modelId, ...profile }) => profile);
  }

  async getEnterpriseConfig(userId: string) {
    const context = await this.enterpriseContext.resolve(userId);
    const [config, connection] = await Promise.all([
      this.prisma.enterpriseModelConfig.findUnique({ where: { enterpriseId: context.enterpriseId } }),
      this.getConnection(),
    ]);
    return {
      policy: this.parsePolicy(config?.mediaPolicy), configured: connection.configured,
      canEdit: context.role === 'ENTERPRISE_ADMIN',
    };
  }

  async updateEnterpriseConfig(userId: string, dto: UpdateMediaPolicyDto) {
    const context = await this.enterpriseContext.resolve(userId);
    this.enterpriseContext.assertEnterpriseAdmin(context);
    const available = await this.availableProfiles();
    try {
      await this.prisma.$transaction(async (tx) => {
        const existing = await tx.enterpriseModelConfig.findUnique({ where: { enterpriseId: context.enterpriseId } });
        const parsed = MediaPolicySchema.safeParse({ ...this.parsePolicy(existing?.mediaPolicy), ...dto });
        if (!parsed.success) throw new BadRequestException('企业媒体策略无效');
        const next = parsed.data;
        next.enabledProfileIds = [...new Set(next.enabledProfileIds)];
        next.allowedOperations = [...new Set(next.allowedOperations)];
        const availableIds = new Set(available.map((profile) => profile.profileId));
        if (next.enabledProfileIds.some((id) => !availableIds.has(id))) {
          throw new BadRequestException('允许列表包含未启用或未验证的媒体 Profile');
        }
        if (next.defaultProfileId && !next.enabledProfileIds.includes(next.defaultProfileId)) {
          throw new BadRequestException('默认媒体 Profile 必须包含在企业允许列表中');
        }
        await tx.enterpriseModelConfig.upsert({
          where: { enterpriseId: context.enterpriseId },
          create: { enterpriseId: context.enterpriseId, mediaPolicy: next as Prisma.InputJsonValue },
          update: { mediaPolicy: next as Prisma.InputJsonValue },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
        throw new ConflictException('企业媒体策略已被其他管理员更新，请重新加载后保存');
      }
      throw error;
    }
    return this.getEnterpriseConfig(userId);
  }

  async getRuntimeMedia(enterpriseId: string): Promise<MediaRuntime> {
    const config = await this.prisma.enterpriseModelConfig.findUnique({ where: { enterpriseId } });
    const policy = this.parsePolicy(config?.mediaPolicy);
    const realEnabled = await this.realRuntimeEnabled();
    const profiles = (await this.availableProfiles())
      .filter((profile) => policy.enabledProfileIds.includes(profile.profileId))
      .filter((profile) => !realEnabled || (isSupportedImageModel(profile.modelId) && profile.executionMode === 'sync-response'))
      .map((profile) => ({
        profileId: profile.profileId, kind: profile.kind, displayName: profile.displayName,
        configVersion: profile.configVersion, executionMode: profile.executionMode,
        operations: profile.operations.filter((operation) => policy.allowedOperations.includes(operation))
          .filter((operation) => !realEnabled || operation === 'generate' || profile.capabilities.supportsReferenceImage),
        capabilities: {
          ...profile.capabilities,
          maxOutputs: Math.min(policy.maxOutputs, profile.capabilities.maxOutputs, realEnabled ? 4 : 8),
          maxWidth: policy.maxWidth, maxHeight: policy.maxHeight,
          sizes: profile.capabilities.sizes.filter((size) => {
            const [width, height] = size.split('x').map(Number);
            const standard: readonly string[] = IMAGE_MODEL_SIZES;
            return (!realEnabled || standard.includes(size)) && width <= policy.maxWidth && height <= policy.maxHeight;
          }),
        },
      }))
      .filter((profile) => profile.operations.length > 0 && profile.capabilities.sizes.length > 0);
    const tools = realEnabled
      ? [
        ...(profiles.some((profile) => profile.operations.includes('generate')) ? ['image_generate'] : []),
        ...(profiles.some((profile) => profile.operations.includes('edit')) ? ['image_edit'] : []),
      ]
      : [];
    return {
      protocolVersion: 1,
      executionAvailable: realEnabled && profiles.length > 0,
      tools, profiles,
      defaultProfileId: profiles.some((profile) => profile.profileId === policy.defaultProfileId)
        ? policy.defaultProfileId : null,
    };
  }
}
