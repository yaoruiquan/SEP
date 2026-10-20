import { z } from 'zod';
import { MediaFundingSchema, MediaMoneySchema } from './media-real.dto';
import {
  MediaVideoGatewayQuoteRequestSchema, MediaVideoGatewayRequestSchema,
  MediaVideoGatewayReferenceSchema, MediaVideoGatewayReceiptSchema,
  MediaVideoRuntimeProfileSchema,
} from './media-video.dto';

// Keep real execution a separate strict contract; never widen the mock discriminator.
export const MediaVideoRealQuoteRequestSchema = MediaVideoGatewayQuoteRequestSchema;
export const MediaVideoRealRequestSchema = MediaVideoGatewayRequestSchema;
export type MediaVideoRealQuoteRequest = z.infer<typeof MediaVideoRealQuoteRequestSchema>;
export type MediaVideoRealRequest = z.infer<typeof MediaVideoRealRequestSchema>;

export const MediaVideoUsdSchema = z.string().regex(/^\d+(?:\.\d{1,12})?$/);
export const MediaVideoRealReferenceSchema = MediaVideoGatewayReferenceSchema.extend({ mock: z.literal(false) }).strict();
export type MediaVideoRealReference = z.infer<typeof MediaVideoRealReferenceSchema>;

export const MediaVideoRealQuoteSchema = z.object({
  mock: z.literal(false),
  quoteId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
  expiresAt: z.string().datetime({ offset: true }),
  semanticSha256: z.string().regex(/^[a-fA-F0-9]{64}$/),
  pricingStatus: z.literal('quoted'),
  amountCny: MediaMoneySchema,
  amountUsd: MediaVideoUsdSchema,
  pricingVersion: z.string().min(1).max(128),
  usdToCnyRate: z.number().finite().positive(),
  billingStatus: z.literal('NOT_RESERVED'),
  funding: MediaFundingSchema,
}).strict();
export type MediaVideoRealQuote = z.infer<typeof MediaVideoRealQuoteSchema>;

export const MediaVideoRealBillingStatusSchema = z.enum(['NOT_RESERVED', 'RESERVED', 'SETTLED', 'RELEASED', 'RECONCILING']);
export const MediaVideoRealReceiptSchema = MediaVideoGatewayReceiptSchema.innerType().extend({
  mock: z.literal(false),
  billingStatus: MediaVideoRealBillingStatusSchema,
  amountCny: MediaMoneySchema.optional(),
  actualCostCny: MediaMoneySchema.optional(),
  amountUsd: MediaVideoUsdSchema.optional(),
}).strict().superRefine((value, ctx) => {
  // A delivered/failed provider task may still need request-driven billing reconciliation.
  // In that window polling is for the billing evidence, not for the terminal provider task.
  const delivered = value.status === 'SUCCEEDED' || value.status === 'PARTIAL_SUCCEEDED';
  const taskTerminal = delivered || ['FAILED', 'CANCELLED', 'RESULT_EXPIRED'].includes(value.status);
  const billingPending = value.billingStatus === 'RESERVED' || value.billingStatus === 'RECONCILING';
  const terminalCanQuery = taskTerminal && billingPending;
  if (new Set(value.outputs.map(output => output.outputId)).size !== value.outputs.length ||
    delivered && value.outputs.length === 0 || value.recovery.canDownload && (!delivered || value.outputs.length === 0) ||
    taskTerminal && (value.pollAfterMs !== null || value.recovery.canQuery !== terminalCanQuery) ||
    !taskTerminal && !value.recovery.canQuery || value.recovery.canCancel) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Inconsistent real video receipt state.' });
  }
});
export type MediaVideoRealReceipt = z.infer<typeof MediaVideoRealReceiptSchema>;

export const MediaVideoRealProfilesSchema = z.object({
  mock: z.literal(false),
  protocolVersion: z.literal(1),
  persistence: z.literal('database'),
  billingStatus: z.literal('NOT_RESERVED'),
  profiles: z.array(MediaVideoRuntimeProfileSchema).min(1).max(64),
}).strict();
export type MediaVideoRealProfiles = z.infer<typeof MediaVideoRealProfilesSchema>;
