import { Injectable, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { MediaVideoGatewayProfilesSchema, MediaVideoGatewayQuoteRequestSchema, MediaVideoGatewayReceiptSchema, MediaVideoGatewayRequestSchema } from 'shared';
import type { MediaVideoGatewayQuoteRequest, MediaVideoGatewayReceipt, MediaVideoGatewayRequest, MediaVideoRuntime } from 'shared';
import fixture from '../../shared/fixtures/media-video-v1.json';
import type { ClientEmploymentClaims } from '../client/client-employment.guard';
import { clientSubscriptionAccessWhere } from '../client/client-subscription-access';
import { PrismaService } from '../../prisma/prisma.service';
import { MediaVideoConfigService } from '../media-config/media-video-config.service';
import { MEDIA_MOCK_PNG } from './media-gateway-mock.adapter';
import { MediaVideoGatewayStore, VIDEO_ADAPTER, videoGatewayError, videoStorageUnavailable } from './media-video-gateway.store';
import type { VideoConfiguration, VideoRequestRecord } from './media-video-gateway.store';

const VIDEO_PROFILE_ID = 'mock-video-from-image';
const VIDEO_CONFIG_VERSION = 'mock-video-v1';
const VIDEO_REFERENCE = MEDIA_MOCK_PNG;
const VIDEO_OUTPUT = Buffer.from(fixture.mediaFixture.base64, 'base64');
const VIDEO_REFERENCE_SHA256 = createHash('sha256').update(VIDEO_REFERENCE).digest('hex');
const VIDEO_OUTPUT_SHA256 = createHash('sha256').update(VIDEO_OUTPUT).digest('hex');
const VIDEO_TTL_MS = 24 * 60 * 60 * 1000;
const ResourceIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);

@Injectable()
export class MediaVideoGatewayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: MediaVideoGatewayStore,
    @Optional() private readonly videoConfig?: MediaVideoConfigService,
  ) {}

  private scope(claims: ClientEmploymentClaims): string {
    return JSON.stringify([claims.enterpriseId, claims.subscriptionId, claims.memberId, claims.sub]);
  }

  private async authorize(claims: ClientEmploymentClaims): Promise<string> {
    const member = await this.prisma.enterpriseMember.findFirst({
      where: { id: claims.memberId, enterpriseId: claims.enterpriseId, userId: claims.sub, user: { status: 'ACTIVE' }, enterprise: { status: 'ACTIVE' } },
      select: { departmentId: true },
    }).catch(() => videoStorageUnavailable());
    if (!member) videoGatewayError(403, 'MEDIA_FORBIDDEN', '当前成员无视频媒体访问权限');
    const subscription = await this.prisma.subscription.findFirst({
      where: clientSubscriptionAccessWhere({
        enterpriseId: claims.enterpriseId, memberId: claims.memberId, departmentId: member.departmentId, role: 'MEMBER',
      }, claims.subscriptionId), select: { id: true },
    }).catch(() => videoStorageUnavailable());
    if (!subscription) videoGatewayError(403, 'MEDIA_FORBIDDEN', '订阅已失效或视频授权已撤销');
    return this.scope(claims);
  }

  async profiles(claims: ClientEmploymentClaims) {
    await this.authorize(claims);
    const profiles = await this.authorizedProfiles(claims);
    return MediaVideoGatewayProfilesSchema.parse({
      mock: true, protocolVersion: 1, persistence: 'database', billingStatus: 'MOCK_NOT_CHARGED', profiles,
    });
  }

  // Only direct legacy test construction in NODE_ENV=test may omit configuration.
  private legacyProfiles() {
    return MediaVideoGatewayProfilesSchema.parse({
      mock: true, protocolVersion: 1, persistence: 'database', billingStatus: 'MOCK_NOT_CHARGED',
      profiles: [{
        profileId: VIDEO_PROFILE_ID, kind: 'video', displayName: 'Mock product video', configVersion: VIDEO_CONFIG_VERSION,
        operations: ['image-to-video'], executionMode: 'async-query',
        capabilities: {
          supportsTextToVideo: false, supportsImageToVideo: true, supportsAudio: false,
          durationsSeconds: [5], aspectRatios: ['9:16'], resolutions: ['720p'], frameRates: [24],
          maxInputBytes: 10 * 1024 * 1024, maxReferenceCount: 1, outputFormats: ['video/mp4'],
          supportsTaskQuery: true, supportsCancel: false, resultRetentionSeconds: 86_400,
        },
      }],
    }).profiles;
  }

  private async authorizedProfiles(claims: ClientEmploymentClaims): Promise<MediaVideoRuntime['profiles']> {
    if (this.videoConfig === undefined) {
      if (process.env.NODE_ENV === 'test') return this.legacyProfiles();
      videoStorageUnavailable();
    }
    const runtime = await this.videoConfig.getRuntimeVideo(claims.enterpriseId).catch(() => videoStorageUnavailable());
    if (runtime.executionMode === 'real' || !runtime.executionAvailable || runtime.profiles.length === 0) {
      videoGatewayError(403, 'MEDIA_FORBIDDEN', '当前企业无可执行视频授权');
    }
    return runtime.profiles;
  }

  private async authorizeProfile(claims: ClientEmploymentClaims, input: Pick<MediaVideoGatewayQuoteRequest, 'profileId' | 'operation'>) {
    const profile = (await this.authorizedProfiles(claims)).find(item => item.profileId === input.profileId);
    if (!profile || !profile.operations.includes(input.operation)) {
      videoGatewayError(403, 'MEDIA_FORBIDDEN', '视频 Profile 或操作授权已撤销');
    }
    return profile;
  }

  async reference(claims: ClientEmploymentClaims, file?: Express.Multer.File, fields?: unknown) {
    const scope = await this.authorize(claims);
    if (!(await this.authorizedProfiles(claims)).some(profile => profile.operations.includes('image-to-video'))) {
      videoGatewayError(403, 'MEDIA_FORBIDDEN', '当前企业无参考图视频授权');
    }
    if (fields && Object.keys(fields).length) videoGatewayError(400, 'INVALID_REFERENCE', '视频参考上传不接受额外字段');
    if (!file || file.mimetype !== 'image/png' || !Buffer.isBuffer(file.buffer) || file.size !== file.buffer.length || !file.buffer.equals(VIDEO_REFERENCE)) {
      videoGatewayError(400, 'INVALID_REFERENCE', 'mock 视频只接受固定参考图 fixture');
    }
    return this.store.saveReference(scope, {
      mock: true, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), mimeType: 'image/png',
      byteLength: file.buffer.length, sha256: VIDEO_REFERENCE_SHA256, width: 1, height: 1,
    });
  }

  async quote(claims: ClientEmploymentClaims, input: MediaVideoGatewayQuoteRequest) {
    const scope = await this.authorize(claims);
    const dto = this.parse(MediaVideoGatewayQuoteRequestSchema, input);
    await this.validateProfile(claims, dto);
    const referenceHashes = await this.referenceHashes(scope, dto.referenceIds);
    return this.store.saveQuote(scope, {
      adapter: VIDEO_ADAPTER, configuration: this.configuration(dto), referenceIds: dto.referenceIds, referenceHashes,
      value: { mock: true, expiresAt: new Date(Date.now() + 60_000).toISOString(), semanticSha256: this.semanticHash(dto, referenceHashes),
        pricingStatus: 'quoted', amountCny: '0.000000', pricingVersion: 'mock-video-v1', billingStatus: 'MOCK_NOT_CHARGED' },
    });
  }

  async submit(claims: ClientEmploymentClaims, input: MediaVideoGatewayRequest) {
    const scope = await this.authorize(claims);
    const dto = this.parse(MediaVideoGatewayRequestSchema, input);
    const existing = await this.store.findByClientId(claims.enterpriseId, dto.clientRequestId, scope, true);
    // Replay uses the frozen hashes, even after the original reference or quote expires.
    if (existing) return this.replay(claims, dto, existing);
    await this.validateProfile(claims, dto);
    const quote = await this.store.findQuote(scope, dto.quoteId);
    if (!quote) videoGatewayError(404, 'MEDIA_NOT_FOUND', '视频报价不可用');
    await this.authorize(claims);
    const referenceHashes = await this.referenceHashes(scope, dto.referenceIds);
    if (Date.parse(quote.value.expiresAt) <= Date.now()) videoGatewayError(409, 'QUOTE_EXPIRED', '视频报价已过期');
    const semanticSha256 = this.semanticHash(dto, referenceHashes);
    if (quote.value.semanticSha256 !== semanticSha256 || JSON.stringify(quote.configuration) !== JSON.stringify(this.configuration(dto)) ||
        JSON.stringify(quote.referenceIds) !== JSON.stringify(dto.referenceIds) || JSON.stringify(quote.referenceHashes) !== JSON.stringify(referenceHashes)) {
      videoGatewayError(409, 'IDEMPOTENCY_CONFLICT', '视频报价与请求内容不一致');
    }
    await this.validateProfile(claims, dto);
    const record = await this.store.claim({
      enterpriseId: claims.enterpriseId, clientRequestId: dto.clientRequestId, scope, semanticSha256,
      referenceIds: dto.referenceIds, referenceHashes, count: 1, configuration: quote.configuration,
      submissionDeadline: new Date(quote.value.expiresAt),
      receipt: { mock: true, clientRequestId: dto.clientRequestId, profileId: dto.profileId, configVersion: dto.configVersion,
        operation: dto.operation, status: 'QUEUED', pollAfterMs: 1000, outputs: [], billingStatus: 'MOCK_NOT_CHARGED', errorCode: null,
        recovery: { canQuery: true, canCancel: false, canDownload: false } },
    });
    return this.replay(claims, dto, record);
  }

  async findByClientId(claims: ClientEmploymentClaims, clientRequestId: string) {
    const scope = await this.authorize(claims);
    this.parse(ResourceIdSchema, clientRequestId);
    const record = await this.store.findByClientId(claims.enterpriseId, clientRequestId, scope);
    if (!record) videoGatewayError(404, 'MEDIA_NOT_FOUND', '未找到视频回执，不代表上游未接单');
    await this.authorizeProfile(claims, record.configuration);
    return (await this.expire(record)).receipt;
  }

  async receipt(claims: ClientEmploymentClaims, receiptId: string) {
    const scope = await this.authorize(claims);
    const record = await this.requireRequest(claims, scope, receiptId);
    if (this.hasAllOutputsExpired(record)) return (await this.expire(record)).receipt;
    const next: MediaVideoGatewayReceipt = structuredClone(record.receipt);
    if (next.status === 'QUEUED') next.status = 'RUNNING';
    else if (next.status === 'RUNNING') {
      next.status = 'SUCCEEDED';
      next.pollAfterMs = null;
      next.recovery = { canQuery: false, canCancel: false, canDownload: true };
      next.outputs = [{
        outputId: `${receiptId}-output-1`, kind: 'video', mimeType: 'video/mp4', byteLength: VIDEO_OUTPUT.length,
        sha256: VIDEO_OUTPUT_SHA256, durationSeconds: fixture.mediaFixture.durationSeconds,
        width: fixture.mediaFixture.width, height: fixture.mediaFixture.height, frameRate: fixture.mediaFixture.frameRate,
        thumbnailOutputId: null, expiresAt: new Date(Date.now() + VIDEO_TTL_MS).toISOString(),
      }];
    } else return record.receipt;
    return (await this.store.advance(record, next)).receipt;
  }

  async content(claims: ClientEmploymentClaims, receiptId: string, outputId: string) {
    const scope = await this.authorize(claims);
    this.parse(ResourceIdSchema, outputId);
    const record = await this.requireRequest(claims, scope, receiptId);
    const output = record.receipt.outputs.find(item => item.outputId === outputId);
    if (!output) videoGatewayError(404, 'MEDIA_NOT_FOUND', '视频结果不可用');
    if (!['SUCCEEDED', 'PARTIAL_SUCCEEDED'].includes(record.receipt.status) || !record.receipt.recovery.canDownload ||
        (output.expiresAt !== null && Date.parse(output.expiresAt) <= Date.now())) {
      videoGatewayError(410, 'RESULT_EXPIRED', '视频结果已过期或不可下载');
    }
    if (output.sha256 !== VIDEO_OUTPUT_SHA256 || output.byteLength !== VIDEO_OUTPUT.length || output.mimeType !== 'video/mp4' ||
        output.durationSeconds !== fixture.mediaFixture.durationSeconds || output.width !== fixture.mediaFixture.width ||
        output.height !== fixture.mediaFixture.height || output.frameRate !== fixture.mediaFixture.frameRate) videoStorageUnavailable();
    return { output, bytes: Buffer.from(VIDEO_OUTPUT) };
  }

  async cancel(claims: ClientEmploymentClaims, receiptId: string): Promise<never> {
    const scope = await this.authorize(claims);
    await this.requireRequest(claims, scope, receiptId);
    videoGatewayError(409, 'CANCEL_UNSUPPORTED', '视频 mock 当前不支持取消');
  }

  private async requireRequest(claims: ClientEmploymentClaims, scope: string, receiptId: string): Promise<VideoRequestRecord> {
    this.parse(ResourceIdSchema, receiptId);
    const record = await this.store.findRequest(scope, receiptId);
    if (!record) videoGatewayError(404, 'MEDIA_NOT_FOUND', '未找到视频回执');
    await this.authorizeProfile(claims, record.configuration);
    return record;
  }

  private async referenceHashes(scope: string, referenceIds: string[]): Promise<string[]> {
    const hashes: string[] = [];
    for (const id of referenceIds) {
      const reference = await this.store.findReference(scope, id);
      if (!reference || Date.parse(reference.expiresAt) <= Date.now()) videoGatewayError(404, 'MEDIA_NOT_FOUND', '视频参考图不可用');
      hashes.push(reference.sha256);
    }
    return hashes;
  }

  private async replay(claims: ClientEmploymentClaims, dto: MediaVideoGatewayRequest, record: VideoRequestRecord) {
    await this.authorizeProfile(claims, record.configuration);
    if (record.semanticSha256 !== this.semanticHash(dto, record.referenceHashes)) {
      videoGatewayError(409, 'IDEMPOTENCY_CONFLICT', 'clientRequestId 已用于不同的视频请求');
    }
    return MediaVideoGatewayReceiptSchema.parse((await this.expire(record)).receipt);
  }

  private hasAllOutputsExpired(record: VideoRequestRecord): boolean {
    return ['SUCCEEDED', 'PARTIAL_SUCCEEDED'].includes(record.receipt.status) && record.receipt.outputs.length > 0 && record.receipt.outputs.every(output =>
      output.expiresAt !== null && Date.parse(output.expiresAt) <= Date.now());
  }

  private async expire(record: VideoRequestRecord): Promise<VideoRequestRecord> {
    if (!this.hasAllOutputsExpired(record)) return record;
    return this.store.advance(record, { ...record.receipt, status: 'RESULT_EXPIRED', pollAfterMs: null,
      errorCode: 'RESULT_EXPIRED', recovery: { canQuery: false, canCancel: false, canDownload: false } });
  }

  private async validateProfile(claims: ClientEmploymentClaims, input: MediaVideoGatewayQuoteRequest): Promise<void> {
    const profile = await this.authorizeProfile(claims, input);
    if (input.configVersion !== profile.configVersion) {
      videoGatewayError(409, 'CONFIG_VERSION_MISMATCH', '视频配置已更新，请刷新运行时并重新报价');
    }
    const capabilities = profile.capabilities;
    if (!capabilities.supportsImageToVideo || !capabilities.durationsSeconds.includes(input.parameters.durationSeconds) ||
        !capabilities.aspectRatios.includes(input.parameters.aspectRatio) || !capabilities.resolutions.includes(input.parameters.resolution) ||
        !capabilities.frameRates.includes(input.parameters.frameRate) || !capabilities.outputFormats.includes(input.parameters.outputFormat) ||
        input.referenceIds.length > capabilities.maxReferenceCount || input.operation !== 'image-to-video' ||
        input.parameters.durationSeconds !== 5 || input.parameters.aspectRatio !== '9:16' || input.parameters.resolution !== '720p' || input.parameters.frameRate !== 24 || input.parameters.audio || input.parameters.outputFormat !== 'video/mp4' || input.referenceIds.length !== 1) {
      videoGatewayError(400, 'INVALID_PARAMETER', '视频 mock Profile 或规格不支持');
    }
  }

  private configuration(input: MediaVideoGatewayQuoteRequest): VideoConfiguration {
    return { adapter: VIDEO_ADAPTER, profileId: input.profileId, configVersion: input.configVersion, operation: 'image-to-video',
      parameters: input.parameters, pricingVersion: 'mock-video-v1', amountCny: '0.000000' };
  }

  private semanticHash(input: MediaVideoGatewayQuoteRequest, referenceHashes: string[]): string {
    return createHash('sha256').update(JSON.stringify({
      profileId: input.profileId, configVersion: input.configVersion, operation: input.operation,
      referenceIds: input.referenceIds, referenceHashes, creativeBrief: input.creativeBrief, parameters: input.parameters,
    })).digest('hex');
  }

  private parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, input: unknown): T {
    const parsed = schema.safeParse(input);
    if (!parsed.success) videoGatewayError(400, 'INVALID_PARAMETER', '视频请求参数无效');
    return parsed.data;
  }
}
