import { HttpException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { Decimal } from '@prisma/client/runtime/library';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingService } from '../setting/setting.service';
import { MediaConfigService } from '../media-config/media-config.service';
import { clientSubscriptionAccessWhere } from '../client/client-subscription-access';
import type { ClientEmploymentClaims } from '../client/client-employment.guard';
import { parseUsdToCnyRate, SETTING_KEYS } from 'shared';
import type { MediaRealQuoteRequest, MediaRealRequest, MediaRealReceipt, MediaRealErrorCode } from 'shared';
import { MediaRealQuoteRequestSchema, MediaRealRequestSchema, MediaRealReceiptSchema } from 'shared';
import { inspectMediaPng } from './media-png';
import { MediaByteCacheService } from './media-byte-cache.service';
import { MediaRealBillingService } from './media-real-billing.service';
import { MediaRealStore, RealRequestRecord, realMediaStorageUnavailable } from './media-real.store';
import { ImageDispatchError, Sub2apiImageAdapter } from './sub2api-image.adapter';
import { isSupportedImageModel } from './image-model-contract';

const REFERENCE_TTL = 15 * 60_000;
const QUOTE_TTL = 60_000;
const OUTPUT_TTL = 24 * 60 * 60_000;
const error = (status: number, code: MediaRealErrorCode, message: string): never => {
  throw new HttpException({ error: { code, message, type: status >= 500 ? 'server_error' : 'invalid_request_error', source: 'platform', param: null } }, status);
};
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

@Injectable()
export class MediaRealService {
  private reconciling = false;
  private reconcileAfterId: string | undefined;
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly setting: SettingService,
    private readonly mediaConfig: MediaConfigService,
    private readonly adapter: Sub2apiImageAdapter,
    private readonly cache: MediaByteCacheService,
    private readonly billing: MediaRealBillingService,
    private readonly store: MediaRealStore,
  ) {}

  async assertRealEnabled() {
    if (this.config.get<string>('MEDIA_GATEWAY_REAL_ENABLED') !== 'true') error(503, 'MEDIA_REAL_DISABLED', '真实图片执行尚未启用');
    const connection = await this.mediaConfig.getConnection();
    if (!connection.configured) error(503, 'MEDIA_REAL_DISABLED', '真实图片连接未配置');
  }

  async profiles(claims: ClientEmploymentClaims) {
    await this.authorize(claims);
    return { mock: false, protocolVersion: 1, persistence: 'database', profiles: (await this.allowedProfiles(claims.enterpriseId)) };
  }

  async uploadReference(claims: ClientEmploymentClaims, file?: Express.Multer.File, fields?: unknown) {
    await this.authorize(claims);
    if (fields && Object.keys(fields as object).length) error(400, 'INVALID_REFERENCE', '参考上传不接受额外字段');
    if (!file || !Buffer.isBuffer(file.buffer) || file.size !== file.buffer.length || file.mimetype !== 'image/png') error(400, 'INVALID_REFERENCE', '需要 PNG 文件');
    let dimensions: { width: number; height: number };
    try { dimensions = inspectMediaPng(file.buffer, 5 * 1024 * 1024); } catch { error(400, 'INVALID_REFERENCE', 'PNG 参考图无效或超出限制'); }
    const expiresAt = new Date(Date.now() + REFERENCE_TTL).toISOString();
    const reference = await this.store.saveReference(this.scope(claims), {
      mock: false, expiresAt, mimeType: 'image/png', byteLength: file.buffer.length, sha256: sha(file.buffer), ...dimensions,
    });
    await this.cache.put('reference', this.scope(claims), reference.referenceId, file.buffer, expiresAt);
    return reference;
  }

  async quote(claims: ClientEmploymentClaims, raw: MediaRealQuoteRequest) {
    await this.authorize(claims);
    const dto = this.parse(MediaRealQuoteRequestSchema, raw);
    const referenceHashes = await this.referenceHashes(claims, dto.referenceIds);
    const profile = await this.requireProfile(claims.enterpriseId, dto);
    const price = await this.adapter.pricing(dto, profile.modelId);
    const rate = await this.usdToCnyRate();
    const amountCny = new Decimal(price.amount_usd!).mul(rate).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6);
    if (new Decimal(amountCny).lte(0)) error(503, 'PRICE_UNAVAILABLE', '图片报价金额无效');
    const funding = await this.billing.quoteFunding(claims, amountCny);
    const expiresAt = new Date(Math.min(Date.now() + QUOTE_TTL, Date.parse(price.expires_at))).toISOString();
    const semanticSha256 = this.semanticHash(dto, referenceHashes);
    return this.store.saveQuote(this.scope(claims), {
      mock: false, expiresAt, semanticSha256, pricingStatus: 'quoted', amountCny,
      pricingVersion: price.pricing_version, billingStatus: 'NOT_RESERVED', funding,
    }, rate);
  }

  async submit(claims: ClientEmploymentClaims, raw: MediaRealRequest): Promise<MediaRealReceipt> {
    await this.authorize(claims);
    const dto = this.parse(MediaRealRequestSchema, raw);
    const prior = await this.store.findByClientId(claims.enterpriseId, dto.clientRequestId);
    if (prior) {
      if (prior.scope !== this.scope(claims) || prior.semanticSha256 !== this.semanticHash(dto, prior.referenceHashes) || JSON.stringify(prior.referenceIds) !== JSON.stringify(dto.referenceIds) || prior.quoteId !== dto.quoteId) error(409, 'IDEMPOTENCY_CONFLICT', '幂等键已用于不同图片请求');
      return this.snapshot(await this.reconcile(prior));
    }
    const hashes = await this.referenceHashes(claims, dto.referenceIds);
    const semanticSha256 = this.semanticHash(dto, hashes);
    const profile = await this.requireProfile(claims.enterpriseId, dto);
    const quote = await this.store.findQuote(dto.quoteId);
    if (!quote || quote.scope !== this.scope(claims)) error(404, 'MEDIA_NOT_FOUND', '报价不可用');
    if (Date.parse(quote.value.expiresAt) <= Date.now()) error(409, 'QUOTE_EXPIRED', '报价已过期，请重新报价');
    if (quote.value.semanticSha256 !== semanticSha256) error(409, 'IDEMPOTENCY_CONFLICT', '请求内容与报价不一致');

    const referenceRows = await Promise.all(dto.referenceIds.map(id => this.store.findReference(id)));
    if (referenceRows.some(row => !row || row.scope !== this.scope(claims))) error(404, 'MEDIA_NOT_FOUND', '参考图不可用');
    const referenceBytes = await Promise.all(dto.referenceIds.map((id, index) => this.cache.get('reference', this.scope(claims), id, {
      sha256: hashes[index], byteLength: referenceRows[index]!.value.byteLength, expiresAt: referenceRows[index]!.value.expiresAt,
    })));
    const rate = quote.usdToCnyRate;
    const nowReceipt: Omit<MediaRealReceipt, 'receiptId'> = {
      mock: false, clientRequestId: dto.clientRequestId, profileId: dto.profileId, configVersion: dto.configVersion,
      executionMode: 'sync-response', status: 'SUBMITTING', pollAfterMs: null, outputs: [], billingStatus: 'RESERVED',
      errorCode: null, outputErrors: [], recovery: { canQuery: true, canCancel: false, canDownload: false },
    };
    const claim = await this.store.claim({
      enterpriseId: claims.enterpriseId, clientRequestId: dto.clientRequestId, quoteId: dto.quoteId,
      scope: this.scope(claims), semanticSha256, referenceIds: dto.referenceIds, referenceHashes: hashes,
      count: dto.parameters.count, configuration: { profileId: profile.profileId, configVersion: profile.configVersion,
        modelId: profile.modelId, operation: dto.operation, parameters: dto.parameters },
      receipt: { ...nowReceipt, receiptId: 'pending' }, upstreamRequestId: null,
      submissionDeadline: new Date(Date.now() + 3 * 60_000),
    });
    if (!claim.created) {
      if (claim.record.scope !== this.scope(claims) || claim.record.semanticSha256 !== semanticSha256 || claim.record.quoteId !== dto.quoteId) error(409, 'IDEMPOTENCY_CONFLICT', '幂等键已用于不同图片请求');
      return this.snapshot(claim.record);
    }
    let record = claim.record;
    const receiptId = record.id;
    try {
      await this.billing.reserve(claims, receiptId, quote.value.amountCny, rate);
    } catch (failure) {
      const insufficient = failure instanceof HttpException && failure.getStatus() === 402;
      record.receipt.status = insufficient ? 'FAILED' : 'SUBMISSION_UNKNOWN';
      record.receipt.billingStatus = insufficient ? 'RELEASED' : 'RECONCILING';
      record.receipt.errorCode = insufficient ? 'INSUFFICIENT_FUNDS' : 'BILLING_PENDING';
      record.receipt.recovery = { canQuery: !insufficient, canCancel: false, canDownload: false };
      await this.store.save(record);
      throw failure;
    }
    try {
      const result = await this.adapter.execute(dto, referenceBytes, async requestId => {
        record.upstreamRequestId = requestId;
        record = await this.saveExecution(record);
      }, profile.modelId);
      record.upstreamRequestId = result.requestId;
      const expiresAt = new Date(Date.now() + OUTPUT_TTL).toISOString();
      for (const [index, bytes] of result.images.entries()) {
        const dimensions = inspectMediaPng(bytes);
        const outputId = `${receiptId}_${index}`;
        const digest = sha(bytes);
        await this.cache.put('output', this.scope(claims), outputId, bytes, expiresAt);
        record.receipt.outputs.push({ outputId, kind: 'image', mimeType: 'image/png', byteLength: bytes.length, ...dimensions, sha256: digest, expiresAt });
      }
      record.receipt.status = record.receipt.outputs.length < dto.parameters.count ? 'PARTIAL_SUCCEEDED' : 'SUCCEEDED';
      record.receipt.errorCode = null;
      if (record.receipt.status === 'PARTIAL_SUCCEEDED') record.receipt.outputErrors = Array.from({ length: dto.parameters.count - record.receipt.outputs.length }, (_, i) => ({ index: record.receipt.outputs.length + i, code: 'OUTPUT_FAILED' as const }));
      record.receipt.recovery = { canQuery: true, canCancel: false, canDownload: record.receipt.outputs.length > 0 };
      record = await this.saveExecution(record);
    } catch (failure) {
      if (failure instanceof ImageDispatchError && failure.definitelyRejected) {
        record.receipt.status = 'FAILED'; record.receipt.errorCode = 'UPSTREAM_FAILED';
        try {
          await this.billing.release(receiptId);
          record.receipt.billingStatus = 'RELEASED';
        } catch {
          record.receipt.billingStatus = 'RECONCILING';
        }
        record.receipt.recovery = { canQuery: record.receipt.billingStatus === 'RECONCILING', canCancel: false, canDownload: false };
      } else {
        record.receipt.status = 'SUBMISSION_UNKNOWN'; record.receipt.billingStatus = 'RECONCILING';
        record.receipt.errorCode = 'SUBMISSION_UNKNOWN'; record.receipt.recovery = { canQuery: true, canCancel: false, canDownload: record.receipt.outputs.length > 0 };
        if (failure instanceof ImageDispatchError) record.upstreamRequestId = failure.requestId;
      }
      record = await this.saveExecution(record);
      return this.snapshot(record);
    }

    return this.snapshot(await this.reconcile(record));
  }

  async findByClientId(claims: ClientEmploymentClaims, id: string) {
    await this.authorize(claims, false);
    const record = await this.store.findByClientId(claims.enterpriseId, id);
    if (!record || record.scope !== this.scope(claims)) error(404, 'MEDIA_NOT_FOUND', '请求不存在');
    return this.snapshot(await this.reconcile(record));
  }

  async receipt(claims: ClientEmploymentClaims, id: string) {
    await this.authorize(claims, false);
    const record = await this.owned(claims, id);
    return this.snapshot(await this.reconcile(record));
  }

  async content(claims: ClientEmploymentClaims, receiptId: string, outputId: string) {
    await this.authorize(claims, false);
    const record = await this.owned(claims, receiptId);
    const output = record.receipt.outputs.find((item) => item.outputId === outputId);
    if (!output) return error(404, 'MEDIA_NOT_FOUND', '结果不可用');
    if (!output.expiresAt || Date.parse(output.expiresAt) <= Date.now()) return error(410, 'RESULT_EXPIRED', '图片结果已过期，不会自动重新生成');
    const bytes = await this.cache.get('output', record.scope, outputId, {
      sha256: output.sha256, byteLength: output.byteLength, expiresAt: output.expiresAt,
    });
    return { output, bytes };
  }

  async cancel(claims: ClientEmploymentClaims, id: string) {
    await this.authorize(claims); await this.owned(claims, id);
    error(409, 'CANCEL_UNSUPPORTED', '真实同步图片请求不支持取消');
  }

  private async authorize(claims: ClientEmploymentClaims, execution = true) {
    if (execution) await this.assertRealEnabled();
    const member = await this.prisma.enterpriseMember.findFirst({
      where: { id: claims.memberId, enterpriseId: claims.enterpriseId, userId: claims.sub, user: { status: 'ACTIVE' } },
      select: { departmentId: true },
    }).catch(() => realMediaStorageUnavailable());
    if (!member) error(403, 'MEDIA_FORBIDDEN', '当前成员无媒体访问权限');
    const subscription = await this.prisma.subscription.findFirst({ where: clientSubscriptionAccessWhere({
      enterpriseId: claims.enterpriseId, memberId: claims.memberId, departmentId: member.departmentId, role: 'MEMBER',
    }, claims.subscriptionId), select: { id: true } }).catch(() => realMediaStorageUnavailable());
    if (!subscription) error(403, 'MEDIA_FORBIDDEN', '订阅已失效或授权已撤销');
  }

  private async allowedProfiles(enterpriseId: string) {
    const runtime = await this.mediaConfig.getRuntimeMedia(enterpriseId);
    if (!runtime.executionAvailable) return [];
    return runtime.profiles.filter(profile => profile.executionMode === 'sync-response' && profile.operations.some(op => ['generate', 'edit'].includes(op)));
  }

  private async requireProfile(enterpriseId: string, dto: MediaRealQuoteRequest) {
    const profile = (await this.allowedProfiles(enterpriseId)).find(item => item.profileId === dto.profileId && item.configVersion === dto.configVersion);
    if (!profile || !profile.operations.includes(dto.operation) || !profile.capabilities.sizes.includes(dto.parameters.size) || dto.parameters.count > profile.capabilities.maxOutputs) error(409, 'CONFIG_CHANGED', '图片 Profile 或企业策略已变更');
    const row = await this.prisma.mediaModelProfile.findUnique({ where: { profileId: dto.profileId } });
    if (!row || row.configVersion !== dto.configVersion || !isSupportedImageModel(row.modelId) || !row.enabled || !row.verified) error(409, 'CONFIG_CHANGED', '当前 Profile 未通过真实图片配置校验');
    return { ...profile, modelId: row.modelId };
  }

  private async referenceHashes(claims: ClientEmploymentClaims, ids: string[]) {
    return Promise.all(ids.map(async id => {
      const row = await this.store.findReference(id);
      if (!row || row.scope !== this.scope(claims)) error(404, 'MEDIA_NOT_FOUND', '参考图不可用');
      if (Date.parse(row.value.expiresAt) <= Date.now()) error(410, 'REFERENCE_EXPIRED', '参考图已过期');
      return row.value.sha256;
    }));
  }

  private async owned(claims: ClientEmploymentClaims, id: string) {
    const record = await this.store.findRequest(id);
    if (!record || record.scope !== this.scope(claims)) error(404, 'MEDIA_NOT_FOUND', '请求不存在');
    return record;
  }

  private semanticHash(dto: MediaRealQuoteRequest, referenceHashes: string[]) {
    return sha(JSON.stringify({ profileId: dto.profileId, configVersion: dto.configVersion, operation: dto.operation,
      referenceHashes, briefSha256: sha(dto.creativeBrief), parameters: dto.parameters }));
  }

  private snapshot(record: RealRequestRecord): MediaRealReceipt {
    const result = structuredClone(record.receipt);
    if (result.status === 'SUBMITTING' && record.submissionDeadline.getTime() <= Date.now()) {
      result.status = 'SUBMISSION_UNKNOWN'; result.errorCode = 'SUBMISSION_UNKNOWN'; result.billingStatus = 'RECONCILING';
    }
    result.recovery.canQuery = ['RESERVED', 'RECONCILING'].includes(result.billingStatus) || result.status === 'SUBMISSION_UNKNOWN';
    if (result.outputs.length && result.outputs.every(output => !output.expiresAt || Date.parse(output.expiresAt) <= Date.now())) {
      result.status = 'RESULT_EXPIRED'; result.errorCode = 'RESULT_EXPIRED'; result.recovery.canDownload = false;
    }
    return MediaRealReceiptSchema.parse(result);
  }

  private async saveExecution(desired: RealRequestRecord): Promise<RealRequestRecord> {
    let candidate = structuredClone(desired);
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await this.store.save(candidate);
      if (current.revision === candidate.revision + 1 &&
        current.upstreamRequestId === candidate.upstreamRequestId &&
        isDeepStrictEqual(current.receipt, candidate.receipt)) return current;
      if (!['SUBMITTING', 'SUBMISSION_UNKNOWN'].includes(current.receipt.status)) return current;
      if (current.upstreamRequestId && desired.upstreamRequestId && current.upstreamRequestId !== desired.upstreamRequestId) realMediaStorageUnavailable();
      // A timeout sweep may win CAS while the original dispatch is still receiving bytes.
      candidate = { ...current, upstreamRequestId: desired.upstreamRequestId ?? current.upstreamRequestId,
        receipt: desired.receipt.status === 'SUBMITTING' ? structuredClone(current.receipt) : structuredClone(desired.receipt) };
      if (['SETTLED', 'RELEASED'].includes(current.receipt.billingStatus)) candidate.receipt.billingStatus = current.receipt.billingStatus;
    }
    return realMediaStorageUnavailable();
  }

  private async reconcile(record: RealRequestRecord): Promise<RealRequestRecord> {
    if (!['RESERVED', 'RECONCILING'].includes(record.receipt.billingStatus) || record.receipt.status === 'SUBMITTING') return record;
    try {
      const billingStatus = await this.billing.status(record.id);
      if (billingStatus === 'SETTLED' || billingStatus === 'RELEASED') {
        record.receipt.billingStatus = billingStatus;
        if (billingStatus === 'RELEASED' && record.receipt.status === 'SUBMISSION_UNKNOWN' && record.receipt.errorCode === 'BILLING_PENDING') record.receipt.status = 'FAILED';
        return this.store.save(record);
      }
      if ((record.receipt.status === 'FAILED' && record.receipt.errorCode === 'UPSTREAM_FAILED') ||
        (record.receipt.status === 'SUBMISSION_UNKNOWN' && record.receipt.errorCode === 'BILLING_PENDING' && billingStatus === 'RESERVED')) {
        await this.billing.release(record.id);
        record.receipt.status = 'FAILED';
        record.receipt.billingStatus = 'RELEASED';
        return this.store.save(record);
      }
      if (!record.upstreamRequestId) return record;
      const usage = await this.adapter.usage(record.upstreamRequestId);
      const configuration = record.configuration as { modelId?: unknown };
      const expectedModel = typeof configuration.modelId === 'string' ? configuration.modelId : 'gpt-image-2';
      if (!isSupportedImageModel(expectedModel) || usage.status !== 'settled' || usage.actual_cost_usd === null || usage.model !== expectedModel ||
        usage.image_count !== record.receipt.outputs.length || !['SUCCEEDED', 'PARTIAL_SUCCEEDED'].includes(record.receipt.status)) {
        record.receipt.billingStatus = 'RECONCILING';
        return this.store.save(record);
      }
      const quote = await this.store.findQuote(record.quoteId);
      if (!quote || quote.scope !== record.scope) return record;
      const rate = quote.usdToCnyRate;
      const actualCny = new Decimal(usage.actual_cost_usd).mul(rate).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6);
      record.receipt.billingStatus = await this.billing.settle(record.receipt.receiptId, actualCny,
        new Decimal(usage.actual_cost_usd).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6), usage.model);
      return this.store.save(record);
    } catch {
      return record;
    }
  }

  @Cron('*/1 * * * *')
  async reconcilePending(): Promise<void> {
    if (this.reconciling) return;
    this.reconciling = true;
    try {
      const page = await this.store.pendingRequests(20, this.reconcileAfterId);
      const candidates = page.records;
      this.reconcileAfterId = page.afterId;
      for (let record of candidates) {
        try {
          if (record.receipt.status === 'SUBMITTING') {
            if (record.submissionDeadline.getTime() > Date.now()) continue;
            record.receipt = this.snapshot(record);
            record = await this.store.save(record);
          }
          await this.reconcile(record);
        } catch {
          // Leave the original request and frozen funds intact for the next bounded pass.
        }
      }
    } catch {
      // Storage outages must not trigger a new execution or a speculative refund.
    } finally {
      this.reconciling = false;
    }
  }

  private scope(claims: ClientEmploymentClaims) { return JSON.stringify([claims.enterpriseId, claims.sub, claims.memberId, claims.subscriptionId]); }
  private parse<T>(schema: z.ZodType<T>, value: unknown): T { try { return schema.parse(value); } catch { error(400, 'INVALID_PARAMETER', '图片请求参数无效'); } }

  private async usdToCnyRate() {
    const raw = await this.setting.getEffectiveValue(SETTING_KEYS.USD_TO_CNY_RATE);
    return parseUsdToCnyRate(raw ?? undefined);
  }

}
