import { HttpException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Decimal } from '@prisma/client/runtime/library';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { parseUsdToCnyRate, SETTING_KEYS } from 'shared';
import { MediaVideoGatewayQuoteRequestSchema, MediaVideoGatewayRequestSchema } from '../../shared/media-video.dto';
import type { MediaVideoGatewayQuoteRequest, MediaVideoGatewayRequest } from '../../shared/media-video.dto';
import { MediaVideoPolicySchema } from '../../shared/media-video-config.dto';
import { isVideoResolutionWithinLimit } from '../../shared/media-video.dto';
import { MediaVideoRealProfilesSchema, MediaVideoRealReceiptSchema } from '../../shared/media-video-real.dto';
import type { MediaVideoRealReceipt } from '../../shared/media-video-real.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingService } from '../setting/setting.service';
import { MediaVideoConfigService } from '../media-config/media-video-config.service';
import type { ClientEmploymentClaims } from '../client/client-employment.guard';
import { clientSubscriptionAccessWhere } from '../client/client-subscription-access';
import { MediaRealBillingService } from './media-real-billing.service';
import { inspectMediaPng } from './media-png';
import { MediaVideoRealStore, VIDEO_REAL_ADAPTER } from './media-video-real.store';
import type { VideoRealRecord } from './media-video-real.store';
import { Sub2apiVideoAdapter, VideoDispatchError } from './sub2api-video.adapter';
import type { Sub2apiVideoConnection } from './sub2api-video.adapter';
import { VideoFileCacheService } from './video-file-cache.service';
import { videoGatewayError as fail, videoStorageUnavailable } from './media-video-gateway.store';

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const ResourceIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const REFERENCE_TTL = 15 * 60_000;
const OUTPUT_TTL = 24 * 60 * 60_000;
const SUBMISSION_TTL = 3 * 60_000;

@Injectable()
export class MediaVideoRealService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly setting: SettingService,
    private readonly videoConfig: MediaVideoConfigService,
    private readonly adapter: Sub2apiVideoAdapter,
    private readonly cache: VideoFileCacheService,
    private readonly billing: MediaRealBillingService,
    private readonly store: MediaVideoRealStore,
  ) {}

  assertRealEnabled(): void {
    if (this.config.get<string>('MEDIA_VIDEO_REAL_ENABLED') !== 'true') fail(503, 'MEDIA_REAL_DISABLED', '真实视频执行未启用');
  }

  async profiles(claims: ClientEmploymentClaims) {
    await this.authorize(claims, true);
    const runtime = await this.videoConfig.getRuntimeVideo(claims.enterpriseId);
    if (!runtime.executionAvailable || (runtime as { executionMode?: string }).executionMode !== 'real') {
      fail(403, 'MEDIA_FORBIDDEN', '当前企业无真实视频授权');
    }
    const profiles = [];
    for (const profile of runtime.profiles) {
      const row = await this.prisma.mediaModelProfile.findUnique({ where: { profileId: profile.profileId } });
      if (row?.kind === 'video' && row.modelId === 'minimax-h3' && row.enabled && row.verified && row.configVersion === profile.configVersion) profiles.push(profile);
    }
    if (!profiles.length) fail(403, 'MEDIA_FORBIDDEN', '当前企业无已验证的真实视频 Profile');
    return MediaVideoRealProfilesSchema.parse({ mock: false, protocolVersion: 1, persistence: 'database', billingStatus: 'NOT_RESERVED', profiles });
  }

  async reference(claims: ClientEmploymentClaims, file?: Express.Multer.File, fields?: unknown) {
    await this.authorize(claims, true);
    const profiles = await this.profiles(claims);
    if (!profiles.profiles.some(p => p.operations.includes('image-to-video') && p.capabilities.supportsImageToVideo)) fail(403, 'MEDIA_FORBIDDEN', '无图生视频授权');
    if (fields && Object.keys(fields as object).length) fail(400, 'INVALID_REFERENCE', '参考上传不接受额外字段');
    if (!file || !Buffer.isBuffer(file.buffer) || file.size !== file.buffer.length || file.mimetype !== 'image/png' || file.size > 10 * 1024 * 1024) fail(400, 'INVALID_REFERENCE', '需要不超过 10MiB 的 PNG 参考图');
    let dimensions: { width: number; height: number };
    try { dimensions = inspectMediaPng(file.buffer, 10 * 1024 * 1024); } catch { fail(400, 'INVALID_REFERENCE', '参考 PNG 无效'); }
    if (!profiles.profiles.some(p => p.operations.includes('image-to-video') && p.capabilities.maxInputBytes >= file.size)) fail(400, 'INVALID_REFERENCE', '参考图超过 Profile 输入限制');
    const expiresAt = new Date(Date.now() + REFERENCE_TTL).toISOString();
    const scope = this.scope(claims);
    const reference = await this.store.saveReference(scope, { mock: false, expiresAt, mimeType: 'image/png',
      sha256: hash(file.buffer), byteLength: file.buffer.length, ...dimensions });
    const stored = await this.cache.saveReference(scope, reference.referenceId, file.buffer, expiresAt);
    if (stored.sha256 !== reference.sha256 || stored.byteLength !== reference.byteLength || stored.width !== reference.width || stored.height !== reference.height) videoStorageUnavailable();
    return reference;
  }

  async quote(claims: ClientEmploymentClaims, raw: MediaVideoGatewayQuoteRequest) {
    await this.authorize(claims, true);
    const input = this.parse(MediaVideoGatewayQuoteRequestSchema, raw);
    const profile = await this.requireProfile(claims, input, true, 'video-quote');
    const references = await this.references(claims, input.referenceIds, profile.capabilities.maxInputBytes);
    const connection = await this.adapter.connection();
    const price = await this.adapter.pricing(connection, input, profile.modelId);
    if (price.model !== profile.modelId || price.operation !== input.operation || price.duration_seconds !== 4 ||
      price.resolution !== '720p' || price.pricing_status !== 'quoted' || price.amount_usd === null) fail(503, 'PRICE_UNAVAILABLE', '视频报价规格不匹配');
    const rate = parseUsdToCnyRate((await this.setting.getEffectiveValue(SETTING_KEYS.USD_TO_CNY_RATE)) ?? undefined);
    const amountUsd = new Decimal(price.amount_usd);
    const amountCny = amountUsd.mul(rate).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6);
    if (!amountUsd.isFinite() || amountUsd.lte(0) || new Decimal(amountCny).lte(0) || new Decimal(amountCny).gt('99999999.999999')) fail(503, 'PRICE_UNAVAILABLE', '视频报价金额无效');
    const expiresAt = new Date(Math.min(Date.now() + 60_000, Date.parse(price.expires_at))).toISOString();
    if (Date.parse(expiresAt) <= Date.now()) fail(409, 'QUOTE_EXPIRED', '视频报价已过期');
    const funding = await this.billing.quoteFunding(claims, amountCny);
    const semanticSha256 = this.semanticHash(input, references.map(r => r.sha256));
    await this.authorize(claims, true);
    await this.requireProfile(claims, input, true, 'video-quote');
    return this.store.saveQuote(this.scope(claims), {
      adapter: VIDEO_REAL_ADAPTER, consumedByClientRequestId: null,
      value: { mock: false, expiresAt, semanticSha256, pricingStatus: 'quoted', amountCny, amountUsd: price.amount_usd,
        pricingVersion: price.pricing_version, usdToCnyRate: rate, billingStatus: 'NOT_RESERVED', funding },
      configuration: { adapter: VIDEO_REAL_ADAPTER, profileId: input.profileId, configVersion: input.configVersion,
        modelId: 'minimax-h3', operation: input.operation, parameters: input.parameters, connectionFingerprint: connection.fingerprint,
        amountCny, amountUsd: price.amount_usd, pricingVersion: price.pricing_version, usdToCnyRate: rate },
      referenceIds: input.referenceIds, referenceHashes: references.map(r => r.sha256),
    });
  }

  async submit(claims: ClientEmploymentClaims, raw: MediaVideoGatewayRequest): Promise<MediaVideoRealReceipt> {
    // Existing requests can be recovered when the execution switch has been turned off.
    await this.authorize(claims, false);
    const input = this.parse(MediaVideoGatewayRequestSchema, raw);
    // The supplier contract contains generation fields only; local quote and
    // idempotency identifiers are passed separately, never as quote-schema keys.
    const { clientRequestId, quoteId: _quoteId, ...generationInput } = input;
    const scope = this.scope(claims);
    const prior = await this.store.findByClientId(claims.enterpriseId, input.clientRequestId, scope, true);
    if (prior) {
      await this.requireProfile(claims, prior.configuration, false, 'video-submit');
      this.assertReplay(input, prior);
      return this.snapshot(await this.recover(claims, prior));
    }
    await this.authorize(claims, true);
    const profile = await this.requireProfile(claims, input, true, 'video-submit');
    const references = await this.references(claims, input.referenceIds, profile.capabilities.maxInputBytes);
    const quote = await this.store.findQuote(scope, input.quoteId);
    if (!quote) fail(404, 'MEDIA_NOT_FOUND', '视频报价不可用');
    if (Date.parse(quote.value.expiresAt) <= Date.now()) fail(409, 'QUOTE_EXPIRED', '视频报价已过期');
    const semanticSha256 = this.semanticHash(input, references.map(r => r.sha256));
    if (semanticSha256 !== quote.value.semanticSha256 || JSON.stringify(input.referenceIds) !== JSON.stringify(quote.referenceIds) ||
      JSON.stringify(input.parameters) !== JSON.stringify(quote.configuration.parameters) || profile.modelId !== quote.configuration.modelId) fail(409, 'IDEMPOTENCY_CONFLICT', '视频请求与冻结报价不一致');
    const connection = await this.frozenConnection(quote.configuration.connectionFingerprint);
    const bytes = await Promise.all(references.map(r => this.cache.readReference(scope, r.referenceId,
      { sha256: r.sha256, byteLength: r.byteLength, expiresAt: r.expiresAt })));
    const claim = await this.store.claim({ enterpriseId: claims.enterpriseId, clientRequestId: input.clientRequestId, scope,
      semanticSha256, referenceIds: input.referenceIds, referenceHashes: references.map(r => r.sha256),
      submissionDeadline: new Date(Date.now() + SUBMISSION_TTL),
      configuration: { ...quote.configuration, quoteId: input.quoteId, upstreamTaskId: null, upstreamRequestId: null,
        dispatchState: 'NOT_DISPATCHED', outputExpiresAt: null },
      receipt: { mock: false, clientRequestId: input.clientRequestId, profileId: input.profileId, configVersion: input.configVersion,
        operation: input.operation, status: 'SUBMITTING', pollAfterMs: 2000, outputs: [], billingStatus: 'NOT_RESERVED',
        amountCny: quote.value.amountCny, amountUsd: quote.value.amountUsd, errorCode: null,
        recovery: { canQuery: true, canCancel: false, canDownload: false } },
    });
    this.assertReplay(input, claim.record);
    if (!claim.created) return this.snapshot(claim.record);
    let record = claim.record;
    try {
      await this.billing.reserve(claims, record.receipt.receiptId, quote.value.amountCny, quote.value.usdToCnyRate);
    } catch (error) {
      const insufficient = error instanceof HttpException && error.getStatus() === 402;
      record.receipt.status = insufficient ? 'FAILED' : 'SUBMISSION_UNKNOWN';
      record.receipt.billingStatus = insufficient ? 'NOT_RESERVED' : 'RECONCILING';
      record.receipt.errorCode = insufficient ? 'INSUFFICIENT_FUNDS' : 'BILLING_PENDING';
      const failedSave = await this.store.save(this.normalize(record));
      record = failedSave.record;
      if (!failedSave.updated && record.receipt.status === 'FAILED') await this.releaseUnsubmitted(record);
      if (insufficient) throw error;
      return this.snapshot(record);
    }
    record.receipt.billingStatus = 'RESERVED';
    let saved = await this.store.save(this.normalize(record));
    if (!saved.updated) {
      // A timeout recovery may have closed dispatch while reserve was committing.
      await this.releaseUnsubmitted(saved.record);
      return this.snapshot((await this.store.findRequest(scope, saved.record.receipt.receiptId)) ?? saved.record);
    }
    record = saved.record;
    // Freeze a dispatch marker before POST. Any crash afterwards can only recover, never resubmit.
    try {
      await this.authorize(claims, true);
      await this.requireProfile(claims, input, true, 'video-submit');
      await this.frozenConnection(record.configuration.connectionFingerprint);
    } catch (error) {
      record.receipt.status = 'FAILED'; record.receipt.errorCode = 'CONFIG_CHANGED';
      saved = await this.store.save(this.normalize(record));
      if (saved.updated) {
        record = saved.record;
        await this.releaseUnsubmitted(record);
      }
      throw error;
    }
    record.configuration.dispatchState = 'DISPATCHING';
    saved = await this.store.save(this.normalize(record));
    if (!saved.updated) return this.snapshot(saved.record);
    record = saved.record;
    try {
      const result = await this.adapter.submit(connection, generationInput, profile.modelId, bytes, clientRequestId,
        record.configuration.pricingVersion);
      record.configuration.upstreamTaskId = result.taskId;
      record.configuration.upstreamRequestId = result.requestId;
      record.configuration.dispatchState = 'ACCEPTED';
      record.receipt.status = result.status === 'queued' ? 'QUEUED' : result.status === 'cancelled' ? 'CANCELLED' : result.status === 'failed' ? 'FAILED' : 'RUNNING';
      record.receipt.errorCode = ['FAILED', 'CANCELLED'].includes(record.receipt.status) ? 'UPSTREAM_FAILED' : null;
      record = await this.saveDispatch(record);
    } catch (error) {
      if (error instanceof VideoDispatchError && error.definitelyRejected) {
        record.configuration.dispatchState = 'REJECTED';
        record.configuration.upstreamRequestId = error.requestId;
        record.receipt.status = 'FAILED'; record.receipt.errorCode = 'UPSTREAM_FAILED';
        record = await this.saveDispatch(record);
        await this.releaseUnsubmitted(record);
        return this.snapshot((await this.store.findRequest(scope, record.receipt.receiptId)) ?? record);
      }
      record.configuration.upstreamRequestId = error instanceof VideoDispatchError ? error.requestId : record.configuration.upstreamRequestId;
      record.receipt.status = 'SUBMISSION_UNKNOWN'; record.receipt.errorCode = 'SUBMISSION_UNKNOWN';
      record.receipt.billingStatus = 'RECONCILING';
      return this.snapshot(await this.saveDispatch(record));
    }
    return this.snapshot(record);
  }

  async findByClientId(claims: ClientEmploymentClaims, clientRequestId: string) {
    await this.authorize(claims, false);
    this.parse(ResourceIdSchema, clientRequestId);
    const record = await this.store.findByClientId(claims.enterpriseId, clientRequestId, this.scope(claims));
    if (!record) fail(404, 'MEDIA_NOT_FOUND', '未找到视频回执，不代表上游未接单');
    await this.requireProfile(claims, record.configuration, false, 'video-query');
    return this.snapshot(await this.recover(claims, record));
  }

  async receipt(claims: ClientEmploymentClaims, receiptId: string) {
    const record = await this.owned(claims, receiptId);
    return this.snapshot(await this.recover(claims, record));
  }

  async content(claims: ClientEmploymentClaims, receiptId: string, outputId: string) {
    const record = await this.owned(claims, receiptId);
    this.parse(ResourceIdSchema, outputId);
    const output = record.receipt.outputs.find(o => o.outputId === outputId);
    if (!output) fail(404, 'MEDIA_NOT_FOUND', '视频输出不存在');
    if (!['SUCCEEDED', 'PARTIAL_SUCCEEDED'].includes(record.receipt.status) || !output.expiresAt || Date.parse(output.expiresAt) <= Date.now()) fail(410, 'RESULT_EXPIRED', '原视频结果已过期，不会重新生成');
    const { metadata, stream } = await this.cache.streamOutput(record.scope, outputId,
      { sha256: output.sha256, byteLength: output.byteLength, expiresAt: output.expiresAt });
    try {
      if (metadata.byteLength > 256 * 1024 * 1024 || metadata.byteLength !== output.byteLength || metadata.sha256 !== output.sha256 ||
        metadata.width !== output.width || metadata.height !== output.height || metadata.durationSeconds !== output.durationSeconds ||
        metadata.frameRate !== output.frameRate || metadata.mimeType !== output.mimeType ||
        record.configuration.parameters.audio && metadata.hasAudio !== true) fail(502, 'OUTPUT_FAILED', '视频输出校验失败');
      await this.authorize(claims, false);
      await this.requireProfile(claims, record.configuration, false, 'video-content');
      return { output, stream };
    } catch (error) { stream.destroy(); throw error; }
  }

  async cancel(claims: ClientEmploymentClaims, receiptId: string): Promise<never> {
    await this.owned(claims, receiptId);
    fail(409, 'CANCEL_UNSUPPORTED', '真实视频当前不支持取消');
  }

  private async recover(claims: ClientEmploymentClaims, initial: VideoRealRecord): Promise<VideoRealRecord> {
    let record = structuredClone(initial);
    const terminal = ['SUCCEEDED', 'PARTIAL_SUCCEEDED', 'FAILED', 'CANCELLED', 'RESULT_EXPIRED'].includes(record.receipt.status);
    // Owned/profile authorization runs before recovery; finalized local results
    // must not depend on the availability of the old upstream connection.
    if (terminal && !['RESERVED', 'RECONCILING'].includes(record.receipt.billingStatus)) return record;
    if (record.configuration.dispatchState === 'NOT_DISPATCHED' && record.submissionDeadline.getTime() <= Date.now() &&
      ['SUBMITTING', 'SUBMISSION_UNKNOWN', 'FAILED'].includes(record.receipt.status)) {
      // Claim FAILED by CAS before releasing a reservation: a late original owner
      // then loses its dispatch CAS and cannot POST after funds have been returned.
      record.receipt.status = 'FAILED'; record.receipt.errorCode = 'BILLING_PENDING';
      const closed = await this.store.save(this.normalize(record));
      if (!closed.updated) return closed.record;
      record = closed.record;
      await this.releaseUnsubmitted(record);
      return (await this.store.findRequest(record.scope, record.receipt.receiptId)) ?? record;
    }
    if (record.receipt.status === 'SUBMITTING') {
      if (record.submissionDeadline.getTime() > Date.now()) return record;
      record.receipt.status = 'SUBMISSION_UNKNOWN'; record.receipt.errorCode = 'SUBMISSION_UNKNOWN';
      record.receipt.billingStatus = 'RECONCILING';
      record = (await this.store.save(this.normalize(record))).record;
    }
    if (!record.configuration.upstreamTaskId && !record.configuration.upstreamRequestId) return record;
    const connection = await this.frozenConnection(record.configuration.connectionFingerprint);
    if (record.configuration.upstreamTaskId && ['QUEUED', 'RUNNING', 'SUBMISSION_UNKNOWN'].includes(record.receipt.status)) {
      let downloading = false;
      try {
        const task = await this.adapter.query(connection, record.configuration.upstreamTaskId, record.configuration.modelId);
        if (task.id !== record.configuration.upstreamTaskId || task.model !== record.configuration.modelId) fail(502, 'UPSTREAM_FAILED', '原视频任务身份不匹配');
        if (task.status === 'completed') {
          if (!record.configuration.outputExpiresAt) {
            record.configuration.outputExpiresAt = new Date(Date.now() + OUTPUT_TTL).toISOString();
            record = (await this.store.save(this.normalize(record))).record;
          }
          // A competing query may have observed a terminal provider failure.
          if (!['QUEUED', 'RUNNING', 'SUBMISSION_UNKNOWN'].includes(record.receipt.status)) return this.reconcile(record, connection);
          if (Date.parse(record.configuration.outputExpiresAt) <= Date.now()) {
            record.receipt.status = 'RESULT_EXPIRED'; record.receipt.errorCode = 'RESULT_EXPIRED';
          } else if (!['SUCCEEDED', 'PARTIAL_SUCCEEDED'].includes(record.receipt.status)) {
            await this.authorize(claims, false);
            await this.requireProfile(claims, record.configuration, false, 'video-query');
            const outputId = `${record.receipt.receiptId}-output-1`;
            downloading = true;
            const { hasAudio, ...metadata } = await this.cache.saveOutput(record.scope, outputId,
              await this.adapter.rawContent(connection, record.configuration.upstreamTaskId), record.configuration.outputExpiresAt);
            // Real metadata is measured from bytes, never copied from requested settings.
            if (!this.acceptableH3Output(metadata) || record.configuration.parameters.audio && hasAudio !== true) fail(502, 'OUTPUT_FAILED', '视频成品与冻结规格不符');
            record.receipt.outputs = [{ ...metadata, outputId, kind: 'video', thumbnailOutputId: null, expiresAt: record.configuration.outputExpiresAt }];
            record.receipt.status = 'SUCCEEDED'; record.receipt.errorCode = null;
          }
        } else if (task.status === 'failed' || task.status === 'cancelled') {
          record.receipt.status = task.status === 'cancelled' ? 'CANCELLED' : 'FAILED'; record.receipt.errorCode = 'UPSTREAM_FAILED';
        } else {
          record.receipt.status = task.status === 'queued' ? 'QUEUED' : 'RUNNING'; record.receipt.errorCode = null;
        }
        record = (await this.store.save(this.normalize(record))).record;
      } catch (error) {
        // Query/download failure keeps the original task and frozen funds. Never POST again.
        if (error instanceof HttpException && [401, 403].includes(error.getStatus())) throw error;
        const current = await this.store.findRequest(record.scope, record.receipt.receiptId);
        if (current && ['QUEUED', 'RUNNING', 'SUBMISSION_UNKNOWN'].includes(current.receipt.status)) {
          current.receipt.errorCode = downloading ? 'OUTPUT_FAILED' : 'UPSTREAM_FAILED';
          record = (await this.store.save(this.normalize(current))).record;
        } else if (current) record = current;
      }
    }
    return this.reconcile(record, connection);
  }

  private async reconcile(initial: VideoRealRecord, connection: Sub2apiVideoConnection): Promise<VideoRealRecord> {
    let record = structuredClone(initial);
    if (!['RESERVED', 'RECONCILING'].includes(record.receipt.billingStatus)) return record;
    try {
      const status = await this.billing.status(record.receipt.receiptId);
      if (status === 'RELEASED') {
        record.receipt.billingStatus = 'RELEASED';
      } else if (record.configuration.upstreamRequestId) {
        if (!(await this.store.hasUniqueUpstreamRequest(record))) fail(409, 'BILLING_PENDING', '原视频账单关联不唯一');
        const usage = await this.adapter.usage(connection, record.configuration.upstreamRequestId);
        if (usage.request_id !== record.configuration.upstreamRequestId || usage.status !== 'settled' ||
          usage.model !== 'minimax-h3' || usage.actual_cost_usd === null || usage.video_count !== 1 ||
          usage.duration_seconds !== 4 || usage.resolution !== '720p') {
          record.receipt.billingStatus = 'RECONCILING';
        } else {
          const actualUsd = new Decimal(usage.actual_cost_usd);
          const actualCny = actualUsd.mul(record.configuration.usdToCnyRate).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6);
          record.receipt.billingStatus = await this.billing.settleVideo(record.receipt.receiptId, actualCny,
            actualUsd.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6), usage.model);
          record.receipt.actualCostCny = actualCny;
        }
      } else {
        record.receipt.billingStatus = 'RECONCILING';
      }
      record = (await this.store.save(this.normalize(record))).record;
    } catch {
      // Missing or contradictory billing evidence is not authorization to release money.
      record.receipt.billingStatus = 'RECONCILING';
      record = (await this.store.save(this.normalize(record))).record;
    }
    return record;
  }

  private async releaseUnsubmitted(record: VideoRealRecord) {
    if (!['NOT_DISPATCHED', 'REJECTED'].includes(record.configuration.dispatchState) || record.receipt.status !== 'FAILED') return;
    try {
      const status = await this.billing.status(record.receipt.receiptId).catch(error => {
        // status() uses BILLING_PENDING for an absent journal row; release() then
        // atomically observes absence or refunds the original reservation.
        if (error instanceof HttpException && (error.getResponse() as { error?: { code?: string } }).error?.code === 'BILLING_PENDING') return null;
        throw error;
      });
      if (status === 'SETTLED' || status === 'RECONCILING') {
        record.receipt.billingStatus = 'RECONCILING';
        await this.store.save(this.normalize(record));
        return;
      }
      await this.billing.release(record.receipt.receiptId);
      record.receipt.billingStatus = 'RELEASED';
    } catch { record.receipt.billingStatus = 'RECONCILING'; }
    await this.store.save(this.normalize(record));
  }

  private async saveDispatch(desired: VideoRealRecord): Promise<VideoRealRecord> {
    let candidate = structuredClone(desired);
    for (let attempt = 0; attempt < 3; attempt++) {
      let saved: Awaited<ReturnType<MediaVideoRealStore['save']>>;
      try { saved = await this.store.save(this.normalize(candidate)); }
      catch (error) {
        if (!(error instanceof HttpException) || error.getStatus() !== 409 ||
          (error.getResponse() as { error?: { code?: string } }).error?.code !== 'BILLING_PENDING') throw error;
        // Preserve the original task, but never attach another receipt's bill.
        // With no trustworthy billing ID recovery must leave funds reconciling.
        desired = structuredClone(desired);
        desired.configuration.upstreamRequestId = null;
        desired.receipt.billingStatus = 'RECONCILING'; desired.receipt.errorCode = 'BILLING_PENDING';
        candidate.configuration.upstreamRequestId = null;
        candidate.receipt.billingStatus = 'RECONCILING'; candidate.receipt.errorCode = 'BILLING_PENDING';
        continue;
      }
      if (saved.updated) return saved.record;
      const current = saved.record;
      if (!['SUBMITTING', 'SUBMISSION_UNKNOWN'].includes(current.receipt.status)) return current;
      if (current.configuration.upstreamTaskId && desired.configuration.upstreamTaskId && current.configuration.upstreamTaskId !== desired.configuration.upstreamTaskId) videoStorageUnavailable();
      candidate = { ...current, configuration: { ...current.configuration, upstreamTaskId: desired.configuration.upstreamTaskId ?? current.configuration.upstreamTaskId,
        upstreamRequestId: desired.configuration.upstreamRequestId ?? current.configuration.upstreamRequestId, dispatchState: desired.configuration.dispatchState },
        receipt: { ...desired.receipt, billingStatus: ['SETTLED', 'RELEASED'].includes(current.receipt.billingStatus) ? current.receipt.billingStatus : desired.receipt.billingStatus } };
    }
    return videoStorageUnavailable();
  }

  private async owned(claims: ClientEmploymentClaims, receiptId: string) {
    await this.authorize(claims, false);
    this.parse(ResourceIdSchema, receiptId);
    const record = await this.store.findRequest(this.scope(claims), receiptId);
    if (!record) fail(404, 'MEDIA_NOT_FOUND', '视频回执不存在');
    await this.requireProfile(claims, record.configuration, false, 'video-query');
    return record;
  }

  private async authorize(claims: ClientEmploymentClaims, execution: boolean) {
    if (execution) this.assertRealEnabled();
    const member = await this.prisma.enterpriseMember.findFirst({
      where: { id: claims.memberId, enterpriseId: claims.enterpriseId, userId: claims.sub, user: { status: 'ACTIVE' }, enterprise: { status: 'ACTIVE' } }, select: { departmentId: true },
    }).catch(() => videoStorageUnavailable());
    if (!member) fail(403, 'MEDIA_FORBIDDEN', '成员无视频访问权限');
    const subscription = await this.prisma.subscription.findFirst({ where: clientSubscriptionAccessWhere({
      enterpriseId: claims.enterpriseId, memberId: claims.memberId, departmentId: member.departmentId, role: 'MEMBER',
    }, claims.subscriptionId), select: { id: true } }).catch(() => videoStorageUnavailable());
    if (!subscription) fail(403, 'MEDIA_FORBIDDEN', '订阅已失效或视频授权已撤销');
  }

  private async requireProfile(claims: ClientEmploymentClaims,
    input: Pick<MediaVideoGatewayQuoteRequest, 'profileId' | 'configVersion' | 'operation' | 'parameters'>, execution: boolean,
    stage: 'video-quote' | 'video-submit' | 'video-query' | 'video-content') {
    const row = await this.prisma.mediaModelProfile.findUnique({ where: { profileId: input.profileId } });
    if (!row || row.kind !== 'video' || row.modelId !== 'minimax-h3' || row.configVersion !== input.configVersion ||
      !row.enabled || !row.verified || row.executionMode !== 'async-query' || !row.operations.includes(input.operation)) fail(409, 'CONFIG_CHANGED', '原视频 Profile 已变更或撤销', { field: 'profileId', stage, recovery: 'refresh_capabilities' });
    const config = await this.prisma.enterpriseModelConfig.findUnique({ where: { enterpriseId: claims.enterpriseId } });
    const raw = config?.mediaPolicy as Record<string, unknown> | null;
    const parsed = MediaVideoPolicySchema.safeParse(raw?.video ?? {});
    if (!parsed.success) fail(403, 'MEDIA_FORBIDDEN', '企业视频策略无效');
    const policy = parsed.data;
    if (!policy.enabledProfileIds.includes(input.profileId)) fail(403, 'MEDIA_FORBIDDEN', '企业视频授权已撤销', { field: 'profileId', stage, recovery: 'refresh_capabilities' });
    if (!policy.allowedOperations.includes(input.operation)) fail(403, 'MEDIA_FORBIDDEN', '视频操作不受企业策略支持', { field: 'operation', stage, recovery: 'revise_request' });
    if (!policy.allowedAspectRatios.includes(input.parameters.aspectRatio)) fail(403, 'MEDIA_FORBIDDEN', '视频画面比例不受企业策略支持', { field: 'parameters.aspectRatio', stage, recovery: 'revise_request' });
    if (policy.maxDurationSeconds < input.parameters.durationSeconds) fail(403, 'MEDIA_FORBIDDEN', '视频时长超过企业策略限制', { field: 'parameters.durationSeconds', stage, recovery: 'revise_request' });
    if (!isVideoResolutionWithinLimit(input.parameters.resolution, policy.maxResolution)) fail(403, 'MEDIA_FORBIDDEN', '视频分辨率不受企业策略支持', { field: 'parameters.resolution', stage, recovery: 'revise_request' });
    const capabilities = this.parse(z.object({
      supportsTextToVideo: z.boolean(), supportsImageToVideo: z.boolean(), supportsAudio: z.boolean(),
      durationsSeconds: z.array(z.number()), resolutions: z.array(z.string()), aspectRatios: z.array(z.string()),
      frameRates: z.array(z.number()), outputFormats: z.array(z.string()), maxInputBytes: z.number().positive(), maxReferenceCount: z.number().int().nonnegative(),
    }), row.capabilities);
    const p = input.parameters;
    if (p.durationSeconds !== 4 || p.resolution !== '720p' || p.aspectRatio !== '16:9' || p.frameRate !== 24 || !p.audio || p.outputFormat !== 'video/mp4' ||
      !capabilities.durationsSeconds.includes(4) || !capabilities.resolutions.includes('720p') || !capabilities.aspectRatios.includes('16:9') ||
      !capabilities.frameRates.includes(24) || !capabilities.supportsAudio || !capabilities.outputFormats.includes('video/mp4') ||
      input.operation === 'text-to-video' && !capabilities.supportsTextToVideo || input.operation === 'image-to-video' &&
      (!capabilities.supportsImageToVideo || capabilities.maxReferenceCount < 1)) fail(400, 'INVALID_PARAMETER', '视频 Profile 不支持冻结规格', { field: 'parameters', stage, recovery: 'revise_request' });
    if (execution) {
      const runtime = await this.videoConfig.getRuntimeVideo(claims.enterpriseId);
      if (!runtime.executionAvailable || (runtime as { executionMode?: string }).executionMode !== 'real' ||
        !runtime.profiles.some(p => p.profileId === input.profileId && p.configVersion === input.configVersion && p.operations.includes(input.operation))) fail(403, 'MEDIA_FORBIDDEN', '当前运行时未授权真实视频');
    }
    return { modelId: row.modelId, capabilities };
  }

  private async references(claims: ClientEmploymentClaims, ids: string[], maxBytes: number) {
    return Promise.all(ids.map(async id => {
      const reference = await this.store.findReference(this.scope(claims), id);
      if (!reference) fail(404, 'MEDIA_NOT_FOUND', '视频参考图不存在');
      if (Date.parse(reference.expiresAt) <= Date.now()) fail(410, 'REFERENCE_EXPIRED', '视频参考图已过期');
      if (reference.byteLength > maxBytes) fail(400, 'INVALID_REFERENCE', '参考图超过 Profile 限制');
      return reference;
    }));
  }

  private async frozenConnection(expected: string) {
    const connection = await this.adapter.connection();
    if (connection.fingerprint !== expected) fail(409, 'CONFIG_CHANGED', '视频连接已变更，原任务不得切换路由');
    return connection;
  }

  private normalize(record: VideoRealRecord): VideoRealRecord {
    const active = ['SUBMITTING', 'SUBMISSION_UNKNOWN', 'QUEUED', 'RUNNING'].includes(record.receipt.status);
    record.receipt.pollAfterMs = active ? 2000 : null;
    record.receipt.recovery = { canCancel: false, canQuery: active || ['RESERVED', 'RECONCILING'].includes(record.receipt.billingStatus),
      canDownload: ['SUCCEEDED', 'PARTIAL_SUCCEEDED'].includes(record.receipt.status) && record.receipt.outputs.some(o => !!o.expiresAt && Date.parse(o.expiresAt) > Date.now()) };
    return record;
  }

  private snapshot(input: VideoRealRecord): MediaVideoRealReceipt {
    const record = this.normalize(structuredClone(input));
    if (['SUCCEEDED', 'PARTIAL_SUCCEEDED'].includes(record.receipt.status) && record.receipt.outputs.length && record.receipt.outputs.every(o => !o.expiresAt || Date.parse(o.expiresAt) <= Date.now())) {
      record.receipt.status = 'RESULT_EXPIRED'; record.receipt.errorCode = 'RESULT_EXPIRED'; this.normalize(record);
    }
    return MediaVideoRealReceiptSchema.parse(record.receipt);
  }

  private assertReplay(input: MediaVideoGatewayRequest, record: VideoRealRecord) {
    if (record.configuration.quoteId !== input.quoteId) fail(409, 'IDEMPOTENCY_CONFLICT', '幂等键已用于不同视频报价');
    if (record.semanticSha256 !== this.semanticHash(input, record.referenceHashes)) fail(409, 'IDEMPOTENCY_CONFLICT', '幂等键请求语义哈希不匹配');
    if (JSON.stringify(record.referenceIds) !== JSON.stringify(input.referenceIds)) fail(409, 'IDEMPOTENCY_CONFLICT', '幂等键参考图不匹配');
  }

  private semanticHash(input: MediaVideoGatewayQuoteRequest, referenceHashes: string[]) {
    return hash(JSON.stringify({ profileId: input.profileId, configVersion: input.configVersion, operation: input.operation,
      referenceIds: input.referenceIds, referenceHashes, briefSha256: hash(input.creativeBrief), parameters: input.parameters }));
  }

  private acceptableH3Output(metadata: { byteLength: number; mimeType: string; durationSeconds: number; width: number; height: number; frameRate: number }): boolean {
    // A6's observed minimax-h3 768P response is 1344x768 even though the
    // compatibility request also carries size=1280x720. Keep measured metadata.
    // The relay reports a 4s request for observed 15s H3 outputs. Accept this
    // provider variant while retaining measured duration and frozen 4s billing.
    const durationMatches = [4, 15].some(seconds => Math.abs(metadata.durationSeconds - seconds) <= 0.5);
    const dimensionsMatch = metadata.width === 1280 && metadata.height === 720 ||
      metadata.width === 1344 && metadata.height === 768;
    return metadata.byteLength > 0 && metadata.byteLength <= 256 * 1024 * 1024 && metadata.mimeType === 'video/mp4' &&
      durationMatches && dimensionsMatch && Math.abs(metadata.frameRate - 24) <= 0.1;
  }
  private scope(claims: ClientEmploymentClaims) { return JSON.stringify([claims.enterpriseId, claims.subscriptionId, claims.memberId, claims.sub]); }
  private parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, raw: unknown): T {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) fail(400, 'INVALID_PARAMETER', '视频参数无效');
    return parsed.data;
  }
}
