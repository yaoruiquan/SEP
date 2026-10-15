import { z } from 'zod';
import { MediaGatewayIdSchema, MediaGatewayOutputSchema, MediaGatewayErrorCodeSchema } from './media-gateway.dto';

export const MediaRealParametersSchema = z.object({
  size: z.enum(['1024x1024', '1536x1024', '1024x1536']).default('1024x1024'),
  count: z.number().int().min(1).max(4).default(1),
  quality: z.enum(['low', 'medium', 'high']).default('medium'),
}).strict();
const request = z.object({
  profileId: MediaGatewayIdSchema, configVersion: MediaGatewayIdSchema,
  operation: z.enum(['generate', 'edit']), referenceIds: z.array(MediaGatewayIdSchema).max(4).default([]),
  creativeBrief: z.string().trim().min(1).max(4000), parameters: MediaRealParametersSchema.default({}),
}).strict();
const referencesValid = (value: z.infer<typeof request>) =>
  (value.operation !== 'edit' || value.referenceIds.length > 0) &&
  (value.operation !== 'generate' || value.referenceIds.length === 0) &&
  new Set(value.referenceIds).size === value.referenceIds.length;
export const MediaRealQuoteRequestSchema = request.refine(referencesValid, '参考图与操作不匹配');
export const MediaRealRequestSchema = request.extend({ clientRequestId: MediaGatewayIdSchema, quoteId: MediaGatewayIdSchema })
  .refine(referencesValid, '参考图与操作不匹配');
export type MediaRealQuoteRequest = z.infer<typeof MediaRealQuoteRequestSchema>;
export type MediaRealRequest = z.infer<typeof MediaRealRequestSchema>;
export const MediaMoneySchema = z.string().regex(/^\d+\.\d{6}$/);
export const MediaFundingSchema = z.object({
  creditCny: MediaMoneySchema, memberWalletCny: MediaMoneySchema, personalCny: MediaMoneySchema,
}).strict();
export const MediaRealReferenceSchema = z.object({
  mock: z.literal(false), referenceId: MediaGatewayIdSchema, expiresAt: z.string().datetime({ offset: true }),
  mimeType: z.literal('image/png'), byteLength: z.number().int().positive().max(5 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), width: z.number().int().positive().max(4096), height: z.number().int().positive().max(4096),
}).strict();
export type MediaRealReference = z.infer<typeof MediaRealReferenceSchema>;
export const MediaRealQuoteSchema = z.object({
  mock: z.literal(false), quoteId: MediaGatewayIdSchema, expiresAt: z.string().datetime({ offset: true }),
  semanticSha256: z.string().regex(/^[a-f0-9]{64}$/), pricingStatus: z.literal('quoted'), amountCny: MediaMoneySchema,
  pricingVersion: z.string().min(1).max(128), billingStatus: z.literal('NOT_RESERVED'), funding: MediaFundingSchema,
}).strict();
export type MediaRealQuote = z.infer<typeof MediaRealQuoteSchema>;
export const MediaRealErrorCodeSchema = z.union([MediaGatewayErrorCodeSchema, z.enum([
  'MEDIA_REAL_DISABLED', 'INSUFFICIENT_FUNDS', 'BILLING_PENDING',
])]);
export type MediaRealErrorCode = z.infer<typeof MediaRealErrorCodeSchema>;
export const MediaRealReceiptSchema = z.object({
  mock: z.literal(false), receiptId: MediaGatewayIdSchema, clientRequestId: MediaGatewayIdSchema,
  profileId: MediaGatewayIdSchema, configVersion: MediaGatewayIdSchema, executionMode: z.literal('sync-response'),
  status: z.enum(['SUBMITTING', 'QUEUED', 'RUNNING', 'SUBMISSION_UNKNOWN', 'SUCCEEDED', 'PARTIAL_SUCCEEDED', 'FAILED', 'CANCELLED', 'RESULT_EXPIRED']),
  pollAfterMs: z.number().int().nonnegative().nullable(), outputs: z.array(MediaGatewayOutputSchema).max(4),
  billingStatus: z.enum(['RESERVED', 'SETTLED', 'RELEASED', 'RECONCILING']), errorCode: MediaRealErrorCodeSchema.nullable(),
  outputErrors: z.array(z.object({ index: z.number().int().min(0).max(3), code: MediaRealErrorCodeSchema }).strict()).max(4),
  recovery: z.object({ canQuery: z.boolean(), canCancel: z.boolean(), canDownload: z.boolean() }).strict(),
}).strict();
export type MediaRealReceipt = z.infer<typeof MediaRealReceiptSchema>;
