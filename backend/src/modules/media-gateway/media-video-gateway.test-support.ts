import { Prisma } from '@prisma/client';
import type { MediaGatewayQuote, MediaGatewayReference, MediaGatewayRequest } from '@prisma/client';
import type { ClientEmploymentClaims } from '../client/client-employment.guard';
import { MEDIA_MOCK_PNG } from './media-gateway-mock.adapter';

export const videoClaims: ClientEmploymentClaims = {
  sub: 'user-1', sid: 'session-1', enterpriseId: 'enterprise-1', subscriptionId: 'sub-1', memberId: 'member-1',
  type: 'client-employment', iat: 1, exp: 9999999999,
};
export const videoScope = (claims = videoClaims) => JSON.stringify([claims.enterpriseId, claims.subscriptionId, claims.memberId, claims.sub]);
export const videoFile = () => ({ buffer: Buffer.from(MEDIA_MOCK_PNG), size: MEDIA_MOCK_PNG.length,
  mimetype: 'image/png', originalname: 'reference.png' }) as Express.Multer.File;
export const videoInput = (referenceId: string) => ({
  profileId: 'mock-video-from-image', configVersion: 'mock-video-v1', operation: 'image-to-video' as const,
  referenceIds: [referenceId], creativeBrief: 'Private product brief must never be persisted',
  parameters: { durationSeconds: 5, aspectRatio: '9:16', resolution: '720p' as const, frameRate: 24, audio: false, outputFormat: 'video/mp4' as const },
});

/** Models the shared unique index and atomic conditional writes, not a substitute store. */
export function createVideoPrismaMock() {
  const references = new Map<string, MediaGatewayReference>();
  const quotes = new Map<string, MediaGatewayQuote>();
  const requests = new Map<string, MediaGatewayRequest>();
  const reference = {
    create: jest.fn(async ({ data }) => {
      const row = { ...structuredClone(data), id: `reference-${references.size + 1}`, createdAt: new Date(), updatedAt: new Date() };
      references.set(row.id, row);
      return structuredClone(row);
    }),
    findUnique: jest.fn(async ({ where }) => structuredClone(references.get(where.id) ?? null)),
  };
  const quote = {
    create: jest.fn(async ({ data }) => {
      const row = { ...structuredClone(data), id: `quote-${quotes.size + 1}`, createdAt: new Date(), updatedAt: new Date() };
      quotes.set(row.id, row);
      return structuredClone(row);
    }),
    findUnique: jest.fn(async ({ where }) => structuredClone(quotes.get(where.id) ?? null)),
  };
  const request = {
    findUnique: jest.fn(async ({ where }) => {
      if (where.id) return structuredClone(requests.get(where.id) ?? null);
      const key = where.enterpriseId_clientRequestId;
      return structuredClone([...requests.values()].find(row => row.enterpriseId === key.enterpriseId && row.clientRequestId === key.clientRequestId) ?? null);
    }),
    create: jest.fn(async ({ data }) => {
      if ([...requests.values()].some(row => row.enterpriseId === data.enterpriseId && row.clientRequestId === data.clientRequestId)) {
        throw new Prisma.PrismaClientKnownRequestError('Unique constraint', { code: 'P2002', clientVersion: 'mock' });
      }
      const row = { ...structuredClone(data), id: `receipt-${requests.size + 1}`, revision: 0, createdAt: new Date(), updatedAt: new Date() };
      requests.set(row.id, row);
      return structuredClone(row);
    }),
    updateMany: jest.fn(async ({ where, data }) => {
      const row = requests.get(where.id);
      if (!row || row.revision !== where.revision || row.status !== where.status || row.scope !== where.scope ||
          row.enterpriseId !== where.enterpriseId || (row.configuration as Prisma.JsonObject).adapter !== where.configuration.equals) {
        return { count: 0 };
      }
      requests.set(row.id, { ...row, receipt: structuredClone(data.receipt), status: data.status,
        revision: row.revision + data.revision.increment, updatedAt: new Date() });
      return { count: 1 };
    }),
  };
  return {
    enterpriseMember: { findFirst: jest.fn().mockResolvedValue({ departmentId: 'department-1' }) },
    subscription: { findFirst: jest.fn().mockResolvedValue({ id: 'sub-1' }) },
    mediaGatewayReference: reference, mediaGatewayQuote: quote, mediaGatewayRequest: request,
    state: { references, quotes, requests },
  };
}
export type VideoPrismaMock = ReturnType<typeof createVideoPrismaMock>;
