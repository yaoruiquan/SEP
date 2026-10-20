import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MediaModelProfile, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  CreateMediaVideoProfileDto, CreateMediaVideoProfileDtoSchema, MediaVideoAvailableProfile,
  MediaVideoEnterpriseConfig, MediaVideoModelDiscovery, MediaVideoPolicy, MediaVideoPolicySchema,
  MediaVideoProfile, MediaVideoProfileSchema, MediaVideoProfileVerification, MediaVideoRuntime,
  MediaVideoRuntimeSchema, UpdateMediaVideoPolicyDto, UpdateMediaVideoPolicyDtoSchema,
  UpdateMediaVideoProfileDto, UpdateMediaVideoProfileDtoSchema, VerifyMediaVideoProfileDto,
  VerifyMediaVideoProfileDtoSchema,
} from 'shared';
import fixture from '../../shared/fixtures/media-video-v1.json';
import { PrismaService } from '../../prisma/prisma.service';
import { EnterpriseContextService } from '../enterprise/enterprise-context.service';
import { MEDIA_MOCK_PNG } from '../media-gateway/media-gateway-mock.adapter';

const MOCK_PROFILE = MediaVideoProfileSchema.parse(fixture.profile);
const RESOLUTIONS = ['480p', '720p', '1080p', '4k'] as const;

@Injectable()
export class MediaVideoConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly enterpriseContext: EnterpriseContextService,
    private readonly config: ConfigService,
  ) {}

  private mockEnabled(): boolean {
    return this.config.get<string>('NODE_ENV') !== 'production'
      && this.config.get<string>('MEDIA_GATEWAY_MOCK_ENABLED') === 'true';
  }

  private profileView(row: MediaModelProfile): MediaVideoProfile {
    const parsed = MediaVideoProfileSchema.safeParse({
      profileId: row.profileId, kind: row.kind, displayName: row.displayName, modelId: row.modelId,
      configVersion: row.configVersion, operations: row.operations, executionMode: row.executionMode,
      capabilities: row.capabilities, enabled: row.enabled, verified: row.verified,
    });
    if (!parsed.success) throw new ServiceUnavailableException('视频 Profile 配置无效，请联系平台管理员');
    return parsed.data;
  }

  private async findProfile(profileId: string): Promise<MediaVideoProfile> {
    const row = await this.prisma.mediaModelProfile.findUnique({ where: { profileId } });
    if (!row || row.kind !== 'video') throw new NotFoundException('视频 Profile 不存在');
    return this.profileView(row);
  }

  private parse<T>(schema: { safeParse(value: unknown): { success: boolean; data?: T } }, value: unknown): T {
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw new BadRequestException('视频配置参数无效');
    return parsed.data!;
  }

  private parsePolicy(mediaPolicy: unknown): MediaVideoPolicy {
    const value = mediaPolicy && typeof mediaPolicy === 'object' && !Array.isArray(mediaPolicy)
      ? (mediaPolicy as Record<string, unknown>).video : undefined;
    const parsed = MediaVideoPolicySchema.safeParse(value ?? {});
    // Invalid stored policy must never accidentally grant access.
    return parsed.success ? parsed.data : MediaVideoPolicySchema.parse({});
  }

  private compatible(profile: MediaVideoProfile): boolean {
    const c = profile.capabilities;
    const supported = MOCK_PROFILE.capabilities;
    return profile.modelId === 'mock-video-v1' && profile.executionMode === 'async-query'
      && profile.operations.every(operation => operation === 'image-to-video')
      && c.supportsImageToVideo && !c.supportsTextToVideo && !c.supportsAudio && !c.supportsCancel
      && c.supportsTaskQuery && c.durationsSeconds.every(value => value === 5)
      && c.aspectRatios.every(value => value === '9:16') && c.resolutions.every(value => value === '720p')
      && c.frameRates.every(value => value === 24) && c.outputFormats.every(value => value === 'video/mp4')
      && c.maxReferenceCount === 1 && c.maxInputBytes >= MEDIA_MOCK_PNG.byteLength && c.maxInputBytes <= supported.maxInputBytes
      && c.resultRetentionSeconds === supported.resultRetentionSeconds;
  }

  private assertExecutable(profile: MediaVideoProfile): void {
    if (!this.mockEnabled()) throw new ServiceUnavailableException('视频仅支持显式启用的 mock，尚未接入真实执行');
    if (!this.compatible(profile)) throw new BadRequestException('当前仅支持 mock-video-v1 fixture：图生视频 5s 9:16 720p 24fps 无音 MP4；真实模型未适配');
  }

  async listProfiles(): Promise<MediaVideoProfile[]> {
    const rows = await this.prisma.mediaModelProfile.findMany({ where: { kind: 'video' }, orderBy: { createdAt: 'asc' } });
    return rows.map(row => this.profileView(row));
  }

  async createProfile(input: CreateMediaVideoProfileDto): Promise<MediaVideoProfile> {
    const dto = this.parse<CreateMediaVideoProfileDto>(CreateMediaVideoProfileDtoSchema, input);
    if (dto.enabled) throw new BadRequestException('视频 Profile 必须先校验 mock 配置后才能启用');
    try {
      const row = await this.prisma.mediaModelProfile.create({
        data: { profileId: dto.profileId, kind: dto.kind, displayName: dto.displayName, modelId: dto.modelId,
          operations: [...new Set(dto.operations)], executionMode: dto.executionMode, capabilities: dto.capabilities,
          configVersion: `cfg_${randomUUID()}`, enabled: false, verified: false },
      });
      return this.profileView(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('媒体 Profile ID 已存在');
      throw error;
    }
  }

  async updateProfile(profileId: string, input: UpdateMediaVideoProfileDto): Promise<MediaVideoProfile> {
    const dto = this.parse<UpdateMediaVideoProfileDto>(UpdateMediaVideoProfileDtoSchema, input);
    const current = await this.findProfile(profileId);
    if (dto.expectedConfigVersion !== current.configVersion) throw new ConflictException('视频配置已更新，请重新加载后保存');
    const { expectedConfigVersion: _version, capabilities, ...changes } = dto;
    const next = this.parse<MediaVideoProfile>(MediaVideoProfileSchema, {
      ...current, ...changes, operations: [...new Set(changes.operations ?? current.operations)],
      capabilities: { ...current.capabilities, ...capabilities },
    });
    const contractChanged = !isDeepStrictEqual(
      [current.modelId, current.operations, current.executionMode, current.capabilities],
      [next.modelId, next.operations, next.executionMode, next.capabilities],
    );
    if (contractChanged) { next.enabled = false; next.verified = false; }
    if (next.enabled) {
      if (!next.verified) throw new BadRequestException('视频 Profile 必须先校验 mock 配置后才能启用');
      this.assertExecutable(next);
    }
    if (isDeepStrictEqual(current, next)) return current;
    const result = await this.prisma.mediaModelProfile.updateMany({
      where: { profileId, kind: 'video', configVersion: current.configVersion },
      data: { displayName: next.displayName, modelId: next.modelId, operations: next.operations,
        executionMode: next.executionMode, capabilities: next.capabilities, enabled: next.enabled, verified: next.verified,
        configVersion: `cfg_${randomUUID()}` },
    });
    if (!result.count) throw new ConflictException('视频配置已更新，请重新加载后保存');
    return this.findProfile(profileId);
  }

  async verifyProfile(profileId: string, input: VerifyMediaVideoProfileDto): Promise<MediaVideoProfileVerification> {
    const dto = this.parse<VerifyMediaVideoProfileDto>(VerifyMediaVideoProfileDtoSchema, input);
    const profile = await this.findProfile(profileId);
    if (dto.expectedConfigVersion !== profile.configVersion) throw new ConflictException('视频配置已更新，请重新加载后校验');
    this.assertExecutable(profile);
    const updated = await this.prisma.mediaModelProfile.updateMany({
      where: { profileId, kind: 'video', configVersion: profile.configVersion },
      data: { verified: true, configVersion: `cfg_${randomUUID()}` },
    });
    if (!updated.count) throw new ConflictException('视频配置在校验期间已更新，请重试');
    return { profile: await this.findProfile(profileId), checkedAt: new Date().toISOString(), executionTested: false, mock: true };
  }

  async discoverModels(): Promise<MediaVideoModelDiscovery> {
    // No upstream catalog call, execution probe, pricing call, or connection credentials.
    return { checkedAt: new Date().toISOString(), mock: true, executionTested: false,
      models: this.mockEnabled() ? [{
        modelId: 'mock-video-v1', displayName: MOCK_PROFILE.displayName, compatible: true,
        reason: '仅离线 mock fixture 兼容，不代表真实模型验证或执行验收',
        suggested: { operations: [...MOCK_PROFILE.operations], executionMode: MOCK_PROFILE.executionMode,
          capabilities: structuredClone(MOCK_PROFILE.capabilities) },
      }] : [],
    };
  }

  private async availableProfiles(): Promise<MediaVideoProfile[]> {
    if (!this.mockEnabled()) return [];
    const rows = await this.prisma.mediaModelProfile.findMany({
      where: { kind: 'video', enabled: true, verified: true }, orderBy: { createdAt: 'asc' },
    });
    return rows.map(row => this.profileView(row)).filter(profile => this.compatible(profile));
  }

  async getAvailableProfiles(userId: string): Promise<MediaVideoAvailableProfile[]> {
    await this.enterpriseContext.resolve(userId);
    return (await this.availableProfiles()).map(({ modelId: _modelId, ...profile }) => profile);
  }

  async getEnterpriseConfig(userId: string): Promise<MediaVideoEnterpriseConfig> {
    const context = await this.enterpriseContext.resolve(userId);
    const config = await this.prisma.enterpriseModelConfig.findUnique({ where: { enterpriseId: context.enterpriseId } });
    return { policy: this.parsePolicy(config?.mediaPolicy), configured: this.mockEnabled(),
      canEdit: context.role === 'ENTERPRISE_ADMIN', mock: true, executionTested: false };
  }

  async updateEnterpriseConfig(userId: string, input: UpdateMediaVideoPolicyDto): Promise<MediaVideoEnterpriseConfig> {
    const dto = this.parse<UpdateMediaVideoPolicyDto>(UpdateMediaVideoPolicyDtoSchema, input);
    const context = await this.enterpriseContext.resolve(userId);
    this.enterpriseContext.assertEnterpriseAdmin(context);
    const available = await this.availableProfiles();
    try {
      await this.prisma.$transaction(async tx => {
        const existing = await tx.enterpriseModelConfig.findUnique({ where: { enterpriseId: context.enterpriseId } });
        const next = this.parse<MediaVideoPolicy>(MediaVideoPolicySchema, { ...this.parsePolicy(existing?.mediaPolicy), ...dto });
        next.enabledProfileIds = [...new Set(next.enabledProfileIds)];
        next.allowedOperations = [...new Set(next.allowedOperations)];
        next.allowedAspectRatios = [...new Set(next.allowedAspectRatios)];
        const availableIds = new Set(available.map(profile => profile.profileId));
        if (next.enabledProfileIds.some(id => !availableIds.has(id))) throw new BadRequestException('允许列表包含未启用、未验证或未适配的视频 Profile');
        if (next.defaultProfileId && !next.enabledProfileIds.includes(next.defaultProfileId)) throw new BadRequestException('默认视频 Profile 必须包含在企业允许列表中');
        const stored = existing?.mediaPolicy;
        if (stored !== null && stored !== undefined && (typeof stored !== 'object' || Array.isArray(stored))) {
          throw new ServiceUnavailableException('企业媒体策略无效，请联系平台管理员');
        }
        // Read/merge/write in one Serializable transaction: preserve the entire image policy.
        const mediaPolicy = { ...(stored as Record<string, Prisma.JsonValue> ?? {}), video: next } as Prisma.InputJsonValue;
        await tx.enterpriseModelConfig.upsert({
          where: { enterpriseId: context.enterpriseId },
          create: { enterpriseId: context.enterpriseId, mediaPolicy }, update: { mediaPolicy },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2002'].includes(error.code)) {
        throw new ConflictException('企业媒体策略已被其他管理员更新，请重新加载后保存');
      }
      throw error;
    }
    return this.getEnterpriseConfig(userId);
  }

  async getRuntimeVideo(enterpriseId: string): Promise<MediaVideoRuntime> {
    const disabled: MediaVideoRuntime = { protocolVersion: 1, executionAvailable: false, defaultProfileId: null, tools: [], profiles: [] };
    if (!this.mockEnabled()) return disabled;
    const config = await this.prisma.enterpriseModelConfig.findUnique({ where: { enterpriseId } });
    const policy = this.parsePolicy(config?.mediaPolicy);
    const profiles = (await this.availableProfiles()).filter(profile => policy.enabledProfileIds.includes(profile.profileId))
      .map(profile => ({
        profileId: profile.profileId, kind: profile.kind, displayName: profile.displayName,
        configVersion: profile.configVersion, executionMode: profile.executionMode,
        operations: profile.operations.filter(operation => policy.allowedOperations.includes(operation)),
        capabilities: { ...profile.capabilities,
          supportsTextToVideo: false, supportsImageToVideo: policy.allowedOperations.includes('image-to-video'), supportsCancel: false,
          durationsSeconds: profile.capabilities.durationsSeconds.filter(value => value <= policy.maxDurationSeconds),
          aspectRatios: profile.capabilities.aspectRatios.filter(value => policy.allowedAspectRatios.includes(value)),
          resolutions: profile.capabilities.resolutions.filter(value => RESOLUTIONS.indexOf(value) <= RESOLUTIONS.indexOf(policy.maxResolution)),
        },
      })).filter(profile => profile.operations.length && profile.capabilities.durationsSeconds.length
        && profile.capabilities.aspectRatios.length && profile.capabilities.resolutions.length);
    return MediaVideoRuntimeSchema.parse({
      protocolVersion: 1, executionAvailable: profiles.length > 0, profiles,
      defaultProfileId: profiles.some(profile => profile.profileId === policy.defaultProfileId) ? policy.defaultProfileId : null,
      tools: profiles.length ? ['video_from_image', 'video_get_job'] : [],
    });
  }
}
