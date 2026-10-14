import { HttpException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import type { ClientEmploymentClaims } from '../client/client-employment.guard';
import { clientSubscriptionAccessWhere } from '../client/client-subscription-access';
import { validateUploadedFile } from '../upload/file-validator';
import {
  MediaGatewayQuoteRequestSchema, MediaGatewayRequestSchema,
  MediaGatewayReceiptSchema,
} from 'shared';
import type {
  MediaGatewayQuoteRequest, MediaGatewayRequest, MediaGatewayReceipt,
  MediaGatewayErrorCode,
} from 'shared';
import {
  MediaGatewayMockAdapter, MEDIA_MOCK_CONFIG_VERSION, MEDIA_MOCK_PNG,
  MEDIA_MOCK_PNG_SHA256, MEDIA_MOCK_PROFILE_IDS, MediaMockProfileId,
} from './media-gateway-mock.adapter';
import { MediaGatewayStore, RequestRecord } from './media-gateway.store';

const REFERENCE_TTL_MS = 15 * 60_000;
const QUOTE_TTL_MS = 60_000;
const OUTPUT_TTL_MS = 5 * 60_000;
const SUBMISSION_TIMEOUT_MS = 2 * 60_000;

export function mediaGatewayError(status: number, code: MediaGatewayErrorCode, message: string): never {
  throw new HttpException({ message, error: {
    code, message, type: status >= 500 ? 'server_error' : 'invalid_request_error', source: 'platform', param: null,
  } }, status);
}

@Injectable()
export class MediaGatewayService {
  private readonly queries = new Map<string, Promise<void>>();

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly adapter: MediaGatewayMockAdapter,
    private readonly store: MediaGatewayStore,
  ) {}

  assertMockEnabled() {
    const environment = this.config.get<string>('NODE_ENV');
    if (!['development', 'test'].includes(environment ?? '') || this.config.get<string>('MEDIA_GATEWAY_MOCK_ENABLED') !== 'true') {
      mediaGatewayError(503, 'MEDIA_MOCK_DISABLED', '图片网关 mock 未启用，真实媒体执行仍关闭');
    }
  }

  async authorize(claims: ClientEmploymentClaims) {
    this.assertMockEnabled();
    const member = await this.prisma.enterpriseMember.findFirst({
      where: { id: claims.memberId, enterpriseId: claims.enterpriseId, userId: claims.sub, user: { status: 'ACTIVE' } },
      select: { departmentId: true },
    });
    if (!member) mediaGatewayError(403, 'MEDIA_FORBIDDEN', '当前成员无媒体访问权限');
    const subscription = await this.prisma.subscription.findFirst({
      where: clientSubscriptionAccessWhere({
        enterpriseId: claims.enterpriseId, memberId: claims.memberId,
        departmentId: member.departmentId, role: 'MEMBER',
      }, claims.subscriptionId), select: { id: true },
    });
    if (!subscription) mediaGatewayError(403, 'MEDIA_FORBIDDEN', '订阅已失效或授权已撤销');
  }

  async profiles(claims: ClientEmploymentClaims) {
    await this.authorize(claims);
    return {
      mock: true, protocolVersion: 1, persistence: 'database', billingStatus: 'MOCK_NOT_CHARGED',
      referenceFixtureSha256: MEDIA_MOCK_PNG_SHA256,
      referenceFixtureBase64: MEDIA_MOCK_PNG.toString('base64'), profiles: this.adapter.profiles(),
    };
  }

  async uploadReference(claims: ClientEmploymentClaims, file?: Express.Multer.File, fields?: unknown) {
    await this.authorize(claims);
    if (fields && Object.keys(fields).length) mediaGatewayError(400, 'INVALID_REFERENCE', '参考上传不接受额外字段');
    if (!file || !Buffer.isBuffer(file.buffer) || file.size !== file.buffer.length || file.mimetype !== 'image/png') {
      mediaGatewayError(400, 'INVALID_REFERENCE', '需要 file 字段中的测试 PNG');
    }
    try { validateUploadedFile(file); }
    catch { mediaGatewayError(400, 'INVALID_REFERENCE', '参考图文件类型或内容无效'); }
    if (!file.buffer.equals(MEDIA_MOCK_PNG)) {
      mediaGatewayError(400, 'INVALID_REFERENCE', 'mock 仅接受 profiles 返回的静态 PNG，不接收真实商品图');
    }
    return this.store.saveReference(this.scope(claims), {
      mock: true, expiresAt: new Date(Date.now() + REFERENCE_TTL_MS).toISOString(),
      mimeType: 'image/png', byteLength: file.buffer.length, sha256: MEDIA_MOCK_PNG_SHA256, width: 1, height: 1,
    });
  }

  async quote(claims: ClientEmploymentClaims, input: MediaGatewayQuoteRequest) {
    await this.authorize(claims);
    const dto = this.parse(MediaGatewayQuoteRequestSchema, input);
    this.validateProfile(dto);
    const hashes = await this.referenceHashes(claims, dto.referenceIds);
    return this.store.saveQuote(this.scope(claims), {
      mock: true, expiresAt: new Date(Date.now() + QUOTE_TTL_MS).toISOString(),
      semanticSha256: this.semanticHash(dto, hashes), pricingStatus: dto.profileId === 'mock-no-price' ? 'unavailable' : 'quoted',
      amountCny: dto.profileId === 'mock-no-price' ? null : '0.010000', pricingVersion: 'mock-v1', billingStatus: 'MOCK_NOT_CHARGED',
    });
  }

  async submit(claims: ClientEmploymentClaims, input: MediaGatewayRequest) {
    await this.authorize(claims);
    const dto = this.parse(MediaGatewayRequestSchema, input);
    const existing = await this.store.findByClientId(claims.enterpriseId, dto.clientRequestId);
    if (existing) return this.replay(claims, dto, existing);
    this.validateProfile(dto);
    const hashes = await this.referenceHashes(claims, dto.referenceIds);
    const semanticSha256 = this.semanticHash(dto, hashes);
    const quote = await this.store.findQuote(dto.quoteId);
    if (!quote || quote.scope !== this.scope(claims)) mediaGatewayError(404, 'MEDIA_NOT_FOUND', '报价不可用');
    if (Date.parse(quote.value.expiresAt) <= Date.now()) mediaGatewayError(409, 'QUOTE_EXPIRED', '报价已过期');
    if (quote.value.semanticSha256 !== semanticSha256) mediaGatewayError(409, 'IDEMPOTENCY_CONFLICT', '报价与请求内容不一致');
    if (quote.value.pricingStatus !== 'quoted') mediaGatewayError(409, 'PRICE_UNAVAILABLE', '价格未知，不能提交生成');
    if (dto.profileId === 'mock-budget') mediaGatewayError(403, 'BUDGET_EXCEEDED', 'mock 模拟预算不足');
    const mode = this.adapter.mode(dto.profileId);
    const claim = await this.store.claim({
      enterpriseId: claims.enterpriseId, clientRequestId: dto.clientRequestId,
      scope: this.scope(claims), semanticSha256, referenceIds: [...dto.referenceIds], referenceHashes: hashes,
      count: dto.parameters.count, submissionDeadline: new Date(Date.now() + SUBMISSION_TIMEOUT_MS),
      configuration: {
        adapter: 'static-png-v1', profileId: dto.profileId as MediaMockProfileId, configVersion: MEDIA_MOCK_CONFIG_VERSION,
        operation: dto.operation, parameters: { size: dto.parameters.size, count: dto.parameters.count },
        pricingVersion: 'mock-v1', amountCny: quote.value.amountCny!,
      },
      receipt: {
        mock: true, clientRequestId: dto.clientRequestId,
        profileId: dto.profileId, configVersion: dto.configVersion, executionMode: mode,
        status: 'SUBMITTING', pollAfterMs: mode === 'async-query' ? 1000 : null,
        outputs: [], outputErrors: [], billingStatus: 'MOCK_NOT_CHARGED', errorCode: null,
        recovery: { canQuery: mode === 'async-query', canCancel: mode === 'async-query' && dto.profileId !== 'mock-no-cancel', canDownload: false },
      },
    });
    if (!claim.created) return this.replay(claims, dto, claim.record);
    const record = await this.recover(claim.record);
    if (record.receipt.status !== 'SUBMITTING') return this.snapshot(record);
    const receipt = record.receipt;
    try {
      receipt.status = await this.adapter.submit(dto.profileId as MediaMockProfileId);
      if (receipt.status === 'SUCCEEDED') this.complete(record, dto.parameters.count);
      if (receipt.status === 'SUBMISSION_UNKNOWN') receipt.errorCode = 'SUBMISSION_UNKNOWN';
    } catch {
      // An ambiguous adapter failure never releases the ID for a second submission.
      receipt.status = 'SUBMISSION_UNKNOWN';
      receipt.errorCode = 'SUBMISSION_UNKNOWN';
      receipt.pollAfterMs = null;
      receipt.recovery.canQuery = false;
      receipt.recovery.canCancel = false;
    }
    // Storage failures must not be classified as adapter failures or trigger another submit.
    return this.snapshot(await this.store.save(record));
  }

  async findByClientId(claims: ClientEmploymentClaims, clientRequestId: string) {
    await this.authorize(claims);
    const record = await this.store.findByClientId(claims.enterpriseId, clientRequestId);
    if (!record || record.scope !== this.scope(claims)) mediaGatewayError(404, 'MEDIA_NOT_FOUND', '未找到回执，不代表上游未接单');
    return this.snapshot(await this.recover(record));
  }

  async receipt(claims: ClientEmploymentClaims, receiptId: string) {
    await this.authorize(claims);
    const record = await this.ownedRequest(claims, receiptId);
    const pending = this.queries.get(receiptId);
    if (pending) await pending;
    else if (record.receipt.recovery.canQuery && ['QUEUED', 'RUNNING'].includes(record.receipt.status)) {
      const query = this.advance(record);
      this.queries.set(receiptId, query);
      try { await query; } finally { this.queries.delete(receiptId); }
    }
    return this.snapshot(await this.ownedRequest(claims, receiptId));
  }

  async content(claims: ClientEmploymentClaims, receiptId: string, outputId: string) {
    await this.authorize(claims);
    const record = await this.ownedRequest(claims, receiptId);
    const output = record.receipt.outputs.find((item) => item.outputId === outputId);
    if (!output) mediaGatewayError(404, 'MEDIA_NOT_FOUND', '结果不可用');
    if (!output.expiresAt || Date.parse(output.expiresAt) <= Date.now()) {
      mediaGatewayError(410, 'RESULT_EXPIRED', '测试结果已过期，不会自动重新生成');
    }
    return { output, bytes: Buffer.from(MEDIA_MOCK_PNG) };
  }

  async cancel(claims: ClientEmploymentClaims, receiptId: string) {
    await this.authorize(claims);
    let record = await this.ownedRequest(claims, receiptId);
    const current = this.snapshot(record);
    if (current.status === 'CANCELLED') return current;
    if (!current.recovery.canCancel) mediaGatewayError(409, 'CANCEL_UNSUPPORTED', '当前 mock 请求不支持取消');
    const query = this.queries.get(receiptId);
    if (query) await query;
    record = await this.ownedRequest(claims, receiptId);
    if (['QUEUED', 'RUNNING'].includes(record.receipt.status)) {
      record.receipt.status = 'CANCELLED';
      record.receipt.pollAfterMs = null;
      record = await this.store.save(record);
    }
    return this.snapshot(record);
  }

  private async advance(record: RequestRecord) {
    const receipt = record.receipt;
    try {
      const status = await this.adapter.query(receipt.profileId as MediaMockProfileId, receipt.status);
      receipt.status = status;
      if (status === 'FAILED') { receipt.errorCode = 'UPSTREAM_FAILED'; receipt.pollAfterMs = null; }
      if (status === 'SUCCEEDED' || status === 'PARTIAL_SUCCEEDED') {
        this.complete(record, record.count);
      }
    } catch {
      // Query failures do not create new submissions or claim a false terminal failure.
      mediaGatewayError(503, 'MEDIA_RATE_LIMITED', 'mock 查询暂不可用，请查询原回执');
    }
    await this.store.save(record);
  }

  private complete(record: RequestRecord, count: number) {
    const receipt = record.receipt;
    const partial = receipt.status === 'PARTIAL_SUCCEEDED';
    const successCount = partial ? Math.max(0, count - 1) : count;
    receipt.outputs = Array.from({ length: successCount }, (_, index) => ({
      outputId: `${receipt.receiptId}_${index}`, kind: 'image' as const, mimeType: 'image/png' as const,
      byteLength: MEDIA_MOCK_PNG.length, width: 1, height: 1, sha256: MEDIA_MOCK_PNG_SHA256,
      expiresAt: new Date(Date.now() + (receipt.profileId === 'mock-expired' ? -1 : OUTPUT_TTL_MS)).toISOString(),
    }));
    if (partial) {
      receipt.outputErrors = [{ index: count - 1, code: 'OUTPUT_FAILED' }];
      if (!successCount) { receipt.status = 'FAILED'; receipt.errorCode = 'OUTPUT_FAILED'; }
    }
    receipt.recovery.canDownload = successCount > 0;
    receipt.pollAfterMs = null;
  }

  private snapshot(record: RequestRecord): MediaGatewayReceipt {
    const receipt = structuredClone(record.receipt);
    if (receipt.outputs.length && receipt.outputs.every((output) => output.expiresAt && Date.parse(output.expiresAt) <= Date.now())) {
      receipt.status = 'RESULT_EXPIRED'; receipt.errorCode = 'RESULT_EXPIRED'; receipt.recovery.canDownload = false;
    }
    // Recovery flags describe actions available now, not just adapter capabilities.
    if (receipt.status === 'SUBMITTING') receipt.recovery.canCancel = false;
    if (!['SUBMITTING', 'QUEUED', 'RUNNING'].includes(receipt.status)) {
      receipt.pollAfterMs = null;
      receipt.recovery.canQuery = false;
      receipt.recovery.canCancel = false;
    }
    return MediaGatewayReceiptSchema.parse(receipt);
  }

  private async referenceHashes(claims: ClientEmploymentClaims, ids: string[]) {
    return Promise.all(ids.map(async (id) => {
      const item = await this.store.findReference(id);
      if (!item || item.scope !== this.scope(claims)) mediaGatewayError(404, 'MEDIA_NOT_FOUND', '参考图不可用');
      if (Date.parse(item.value.expiresAt) <= Date.now()) mediaGatewayError(410, 'REFERENCE_EXPIRED', '参考图已过期');
      return item.value.sha256;
    }));
  }

  private validateProfile(dto: MediaGatewayQuoteRequest) {
    if (!MEDIA_MOCK_PROFILE_IDS.includes(dto.profileId as MediaMockProfileId)) mediaGatewayError(422, 'UNSUPPORTED_MEDIA_PARAMETERS', '仅支持 mock profiles，不接受真实模型 ID');
    if (dto.configVersion !== MEDIA_MOCK_CONFIG_VERSION) mediaGatewayError(409, 'CONFIG_CHANGED', 'mock 配置版本不匹配');
  }

  private parse<T>(schema: { safeParse: (input: unknown) => { success: true; data: T } | { success: false } }, input: unknown): T {
    const parsed = schema.safeParse(input);
    if (!parsed.success) mediaGatewayError(400, 'INVALID_PARAMETER', '媒体请求字段无效');
    return parsed.data;
  }

  private semanticHash(dto: MediaGatewayQuoteRequest, hashes: string[]) {
    return createHash('sha256').update(JSON.stringify({
      profileId: dto.profileId, configVersion: dto.configVersion, operation: dto.operation,
      creativeBrief: dto.creativeBrief, parameters: { size: dto.parameters.size, count: dto.parameters.count }, references: hashes,
    })).digest('hex');
  }

  private async ownedRequest(claims: ClientEmploymentClaims, id: string) {
    const record = await this.store.findRequest(id);
    if (!record || record.scope !== this.scope(claims)) mediaGatewayError(404, 'MEDIA_NOT_FOUND', '回执不可用');
    return this.recover(record);
  }

  private scope(claims: ClientEmploymentClaims) { return JSON.stringify([claims.enterpriseId, claims.subscriptionId, claims.memberId, claims.sub]); }

  private async replay(claims: ClientEmploymentClaims, dto: MediaGatewayRequest, record: RequestRecord) {
    if (record.scope !== this.scope(claims)) mediaGatewayError(404, 'MEDIA_NOT_FOUND', '回执不可用');
    // Exact original references remain replayable after their TTL, using frozen content hashes.
    const hashes = dto.referenceIds.length === record.referenceIds.length &&
      dto.referenceIds.every((id, i) => id === record.referenceIds[i])
      ? record.referenceHashes : await this.referenceHashes(claims, dto.referenceIds);
    if (this.semanticHash(dto, hashes) !== record.semanticSha256) {
      mediaGatewayError(409, 'IDEMPOTENCY_CONFLICT', '相同 clientRequestId 对应不同请求内容');
    }
    return this.snapshot(await this.recover(record));
  }

  private async recover(record: RequestRecord): Promise<RequestRecord> {
    if (record.receipt.status === 'SUBMITTING' && record.submissionDeadline.getTime() <= Date.now()) {
      record.receipt.status = 'SUBMISSION_UNKNOWN';
      record.receipt.errorCode = 'SUBMISSION_UNKNOWN';
      record.receipt.pollAfterMs = null;
      record.receipt.recovery = { canQuery: false, canCancel: false, canDownload: false };
      return this.store.save(record);
    }
    return record;
  }
}
