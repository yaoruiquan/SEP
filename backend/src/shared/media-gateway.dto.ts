import { z } from 'zod';
import { MediaExecutionModeSchema, MediaOperationSchema } from './media.dto';

export const MediaGatewayIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);

export const MediaGatewayParametersSchema = z.object({
  size: z.literal('1x1').default('1x1'),
  count: z.number().int().min(1).max(4).default(1),
}).strict();
export type MediaGatewayParameters = z.infer<typeof MediaGatewayParametersSchema>;

// Employment scope comes from the HTTP token, never from this payload.
const MediaGatewayQuoteRequestBaseSchema = z.object({
  profileId: MediaGatewayIdSchema,
  configVersion: MediaGatewayIdSchema,
  operation: MediaOperationSchema,
  referenceIds: z.array(MediaGatewayIdSchema).max(4).default([]),
  creativeBrief: z.string().trim().min(1).max(4000),
  parameters: MediaGatewayParametersSchema.default({}),
}).strict();

function refineReferences(
  value: z.infer<typeof MediaGatewayQuoteRequestBaseSchema>,
  ctx: z.RefinementCtx,
): void {
  if (value.operation === 'edit' && value.referenceIds.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['referenceIds'],
      message: 'Editing requires at least one reference.',
    });
  }
  if (new Set(value.referenceIds).size !== value.referenceIds.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['referenceIds'],
      message: 'Reference IDs must be unique.',
    });
  }
}

export const MediaGatewayQuoteRequestSchema = MediaGatewayQuoteRequestBaseSchema
  .superRefine(refineReferences);
export type MediaGatewayQuoteRequest = z.infer<typeof MediaGatewayQuoteRequestSchema>;

export const MediaGatewayRequestSchema = MediaGatewayQuoteRequestBaseSchema.extend({
  clientRequestId: MediaGatewayIdSchema,
  quoteId: MediaGatewayIdSchema,
}).superRefine(refineReferences);
export type MediaGatewayRequest = z.infer<typeof MediaGatewayRequestSchema>;

const Sha256Schema = z.string().regex(/^[a-fA-F0-9]{64}$/);
const ExpiresAtSchema = z.string().datetime({ offset: true });
const PositiveIntegerSchema = z.number().int().positive();

export const MediaGatewayReferenceSchema = z.object({
  mock: z.literal(true),
  referenceId: MediaGatewayIdSchema,
  expiresAt: ExpiresAtSchema,
  mimeType: z.literal('image/png'),
  byteLength: PositiveIntegerSchema.max(5 * 1024 * 1024),
  sha256: Sha256Schema,
  width: PositiveIntegerSchema.max(4096),
  height: PositiveIntegerSchema.max(4096),
}).strict();
export type MediaGatewayReference = z.infer<typeof MediaGatewayReferenceSchema>;

export const MediaGatewayQuoteSchema = z.object({
  mock: z.literal(true),
  quoteId: MediaGatewayIdSchema,
  expiresAt: ExpiresAtSchema,
  semanticSha256: Sha256Schema,
  pricingStatus: z.enum(['quoted', 'unavailable']),
  amountCny: z.string().regex(/^\d+\.\d{6}$/).nullable(),
  pricingVersion: z.literal('mock-v1'),
  billingStatus: z.literal('MOCK_NOT_CHARGED'),
}).strict().superRefine((value, ctx) => {
  if ((value.pricingStatus === 'quoted') !== (value.amountCny !== null)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['amountCny'],
      message: 'Quoted pricing requires an amount; unavailable pricing requires null.',
    });
  }
});
export type MediaGatewayQuote = z.infer<typeof MediaGatewayQuoteSchema>;

export const MediaGatewayOutputSchema = z.object({
  outputId: MediaGatewayIdSchema,
  kind: z.literal('image'),
  mimeType: z.literal('image/png'),
  byteLength: PositiveIntegerSchema,
  width: PositiveIntegerSchema,
  height: PositiveIntegerSchema,
  sha256: Sha256Schema,
  expiresAt: ExpiresAtSchema.nullable(),
}).strict();
export type MediaGatewayOutput = z.infer<typeof MediaGatewayOutputSchema>;

export const MediaGatewayErrorCodeSchema = z.enum([
  'MEDIA_MOCK_DISABLED',
  'MEDIA_FORBIDDEN',
  'MEDIA_NOT_FOUND',
  'UNSUPPORTED_MEDIA_PARAMETERS',
  'INVALID_REFERENCE',
  'REFERENCE_EXPIRED',
  'QUOTE_EXPIRED',
  'CONFIG_CHANGED',
  'IDEMPOTENCY_CONFLICT',
  'PRICE_UNAVAILABLE',
  'BUDGET_EXCEEDED',
  'RESULT_EXPIRED',
  'CANCEL_UNSUPPORTED',
  'MEDIA_RATE_LIMITED',
  'UPSTREAM_FAILED',
  'SUBMISSION_UNKNOWN',
  'OUTPUT_FAILED',
  'INVALID_PARAMETER',
]);
export type MediaGatewayErrorCode = z.infer<typeof MediaGatewayErrorCodeSchema>;

export const MediaGatewayReceiptSchema = z.object({
  mock: z.literal(true),
  receiptId: MediaGatewayIdSchema,
  clientRequestId: MediaGatewayIdSchema,
  profileId: MediaGatewayIdSchema,
  configVersion: MediaGatewayIdSchema,
  executionMode: MediaExecutionModeSchema,
  status: z.enum([
    'SUBMITTING',
    'QUEUED',
    'RUNNING',
    'SUBMISSION_UNKNOWN',
    'SUCCEEDED',
    'PARTIAL_SUCCEEDED',
    'FAILED',
    'CANCELLED',
    'RESULT_EXPIRED',
  ]),
  pollAfterMs: z.number().int().nonnegative().nullable(),
  outputs: z.array(MediaGatewayOutputSchema).max(4),
  billingStatus: z.literal('MOCK_NOT_CHARGED'),
  errorCode: MediaGatewayErrorCodeSchema.nullable(),
  outputErrors: z.array(z.object({
    index: z.number().int().min(0).max(3),
    code: MediaGatewayErrorCodeSchema,
  }).strict()),
  recovery: z.object({
    canQuery: z.boolean(),
    canCancel: z.boolean(),
    canDownload: z.boolean(),
  }).strict(),
}).strict();
export type MediaGatewayReceipt = z.infer<typeof MediaGatewayReceiptSchema>;
