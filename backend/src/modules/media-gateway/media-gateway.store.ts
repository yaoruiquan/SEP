import { HttpException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { MediaGatewayRequest as RequestRow } from '@prisma/client';
import { z } from 'zod';
import {
  MediaGatewayQuoteSchema, MediaGatewayReceiptSchema, MediaGatewayReferenceSchema,
} from 'shared';
import type { MediaGatewayQuote, MediaGatewayReceipt, MediaGatewayReference } from 'shared';
import { PrismaService } from '../../prisma/prisma.service';
import { MEDIA_MOCK_CONFIG_VERSION, MEDIA_MOCK_PROFILE_IDS } from './media-gateway-mock.adapter';

export type ReferenceRecord = { scope: string; value: MediaGatewayReference };
export type QuoteRecord = { scope: string; value: MediaGatewayQuote };
const MockConfigurationSchema = z.object({
  adapter: z.literal('static-png-v1'), profileId: z.enum(MEDIA_MOCK_PROFILE_IDS),
  configVersion: z.literal(MEDIA_MOCK_CONFIG_VERSION), operation: z.enum(['generate', 'edit']),
  parameters: z.object({ size: z.literal('1x1'), count: z.number().int().min(1).max(4) }).strict(),
  pricingVersion: z.literal('mock-v1'), amountCny: z.string().regex(/^\d+\.\d{6}$/),
}).strict();
export type MockConfiguration = z.infer<typeof MockConfigurationSchema>;
export type RequestRecord = {
  enterpriseId: string; clientRequestId: string; scope: string; semanticSha256: string;
  referenceIds: string[]; referenceHashes: string[]; count: number;
  configuration: MockConfiguration; receipt: MediaGatewayReceipt;
  revision: number; submissionDeadline: Date;
};
export type RequestClaim = Omit<RequestRecord, 'revision' | 'receipt'> & {
  receipt: Omit<MediaGatewayReceipt, 'receiptId'>;
};

export function mediaStorageUnavailable(): never {
  throw new HttpException({ message: '媒体存储暂不可用，请查原请求，不要重新生成', error: {
    code: 'MEDIA_STORAGE_UNAVAILABLE', message: '媒体存储暂不可用，请查原请求，不要重新生成',
    type: 'server_error', source: 'platform', param: null,
  } }, 503);
}

@Injectable()
export class MediaGatewayStore {
  constructor(private readonly prisma: PrismaService) {}

  async saveReference(scope: string, value: Omit<MediaGatewayReference, 'referenceId'>): Promise<MediaGatewayReference> {
    return this.safe(async () => {
      const row = await this.prisma.mediaGatewayReference.create({ data: {
        scope, metadata: value, expiresAt: new Date(value.expiresAt),
      } });
      return MediaGatewayReferenceSchema.parse({ ...value, referenceId: row.id });
    });
  }

  async findReference(id: string): Promise<ReferenceRecord | null> {
    return this.safe(async () => {
      const row = await this.prisma.mediaGatewayReference.findUnique({ where: { id } });
      return row ? { scope: row.scope, value: MediaGatewayReferenceSchema.parse({
        ...(row.metadata as Prisma.JsonObject), referenceId: row.id,
      }) } : null;
    });
  }

  async saveQuote(scope: string, value: Omit<MediaGatewayQuote, 'quoteId'>): Promise<MediaGatewayQuote> {
    return this.safe(async () => {
      const row = await this.prisma.mediaGatewayQuote.create({ data: {
        scope, metadata: value, expiresAt: new Date(value.expiresAt),
      } });
      return MediaGatewayQuoteSchema.parse({ ...value, quoteId: row.id });
    });
  }

  async findQuote(id: string): Promise<QuoteRecord | null> {
    return this.safe(async () => {
      const row = await this.prisma.mediaGatewayQuote.findUnique({ where: { id } });
      return row ? { scope: row.scope, value: MediaGatewayQuoteSchema.parse({
        ...(row.metadata as Prisma.JsonObject), quoteId: row.id,
      }) } : null;
    });
  }

  async findRequest(id: string): Promise<RequestRecord | null> {
    return this.safe(async () => {
      const row = await this.prisma.mediaGatewayRequest.findUnique({ where: { id } });
      return row ? this.decode(row) : null;
    });
  }

  async findByClientId(enterpriseId: string, clientRequestId: string): Promise<RequestRecord | null> {
    return this.safe(async () => {
      const row = await this.prisma.mediaGatewayRequest.findUnique({
        where: { enterpriseId_clientRequestId: { enterpriseId, clientRequestId } },
      });
      return row ? this.decode(row) : null;
    });
  }

  async claim(input: RequestClaim): Promise<{ record: RequestRecord; created: boolean }> {
    return this.safe(async () => {
      try {
        // Only an acknowledged insert may submit. An ambiguous write never retries here.
        const row = await this.prisma.mediaGatewayRequest.create({ data: {
          ...input, status: input.receipt.status,
        } });
        return { record: this.decode(row), created: true };
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
        const record = await this.findByClientId(input.enterpriseId, input.clientRequestId);
        if (!record) mediaStorageUnavailable();
        return { record, created: false };
      }
    });
  }

  async save(record: RequestRecord): Promise<RequestRecord> {
    return this.safe(async () => {
      const { receiptId, ...receipt } = record.receipt;
      // No transaction is held over an adapter call. A stale query cannot overwrite cancellation.
      await this.prisma.mediaGatewayRequest.updateMany({
        where: { id: receiptId, revision: record.revision },
        data: { receipt, status: receipt.status, revision: { increment: 1 } },
      });
      const current = await this.findRequest(receiptId);
      if (!current) mediaStorageUnavailable();
      return current;
    });
  }

  private decode(row: RequestRow): RequestRecord {
    const configuration = MockConfigurationSchema.parse(row.configuration);
    const receipt = MediaGatewayReceiptSchema.parse({
      ...(row.receipt as Prisma.JsonObject), receiptId: row.id, status: row.status,
    });
    if (receipt.clientRequestId !== row.clientRequestId || receipt.profileId !== configuration.profileId ||
        receipt.configVersion !== configuration.configVersion || row.count !== configuration.parameters.count ||
        row.referenceIds.length !== row.referenceHashes.length) mediaStorageUnavailable();
    return {
      enterpriseId: row.enterpriseId, clientRequestId: row.clientRequestId,
      scope: row.scope, semanticSha256: row.semanticSha256,
      referenceIds: row.referenceIds, referenceHashes: row.referenceHashes, count: row.count,
      configuration, receipt,
      revision: row.revision, submissionDeadline: row.submissionDeadline,
    };
  }

  private async safe<T>(action: () => Promise<T>): Promise<T> {
    try { return await action(); }
    catch (error) {
      if (error instanceof HttpException) throw error;
      mediaStorageUnavailable();
    }
  }
}
