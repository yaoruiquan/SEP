import { randomUUID } from 'node:crypto';
import type { MediaGatewayQuote, MediaGatewayReference } from 'shared';
import {
  mediaStorageUnavailable,
} from '../../src/modules/media-gateway/media-gateway.store';
import type {
  MediaGatewayStore, QuoteRecord, ReferenceRecord, RequestClaim, RequestRecord,
} from '../../src/modules/media-gateway/media-gateway.store';

type StoredRequest = Omit<RequestRecord, 'submissionDeadline'> & { submissionDeadline: string };

export type MediaGatewayMemoryState = {
  references: Map<string, ReferenceRecord>;
  quotes: Map<string, QuoteRecord>;
  requests: Map<string, StoredRequest>;
  clientIds: Map<string, string>;
};

export function createMediaGatewayMemoryState(): MediaGatewayMemoryState {
  return { references: new Map(), quotes: new Map(), requests: new Map(), clientIds: new Map() };
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// A deterministic service-test double, not evidence for PostgreSQL concurrency or durability.
export class MediaGatewayMemoryStore implements Pick<MediaGatewayStore, keyof MediaGatewayStore> {
  constructor(readonly state = createMediaGatewayMemoryState()) {}

  async saveReference(scope: string, input: Omit<MediaGatewayReference, 'referenceId'>): Promise<MediaGatewayReference> {
    const value = { ...jsonClone(input), referenceId: randomUUID() };
    this.state.references.set(value.referenceId, { scope, value: jsonClone(value) });
    return jsonClone(value);
  }

  async findReference(id: string): Promise<ReferenceRecord | null> {
    const record = this.state.references.get(id);
    return record ? jsonClone(record) : null;
  }

  async saveQuote(scope: string, input: Omit<MediaGatewayQuote, 'quoteId'>): Promise<MediaGatewayQuote> {
    const value = { ...jsonClone(input), quoteId: randomUUID() };
    this.state.quotes.set(value.quoteId, { scope, value: jsonClone(value) });
    return jsonClone(value);
  }

  async findQuote(id: string): Promise<QuoteRecord | null> {
    const record = this.state.quotes.get(id);
    return record ? jsonClone(record) : null;
  }

  async findRequest(id: string): Promise<RequestRecord | null> {
    const record = this.state.requests.get(id);
    return record ? this.decode(record) : null;
  }

  async findByClientId(enterpriseId: string, clientRequestId: string): Promise<RequestRecord | null> {
    const id = this.state.clientIds.get(JSON.stringify([enterpriseId, clientRequestId]));
    return id ? this.findRequest(id) : null;
  }

  async claim(input: RequestClaim): Promise<{ record: RequestRecord; created: boolean }> {
    const key = JSON.stringify([input.enterpriseId, input.clientRequestId]);
    const existingId = this.state.clientIds.get(key);
    if (existingId) {
      const existing = this.state.requests.get(existingId);
      if (!existing) mediaStorageUnavailable();
      return { record: this.decode(existing), created: false };
    }
    // No await between the unique-key check and insert, matching an atomic claim.
    const record: StoredRequest = {
      ...jsonClone(input), submissionDeadline: input.submissionDeadline.toISOString(), revision: 0,
      receipt: { ...jsonClone(input.receipt), receiptId: randomUUID() },
    };
    this.state.requests.set(record.receipt.receiptId, record);
    this.state.clientIds.set(key, record.receipt.receiptId);
    return { record: this.decode(record), created: true };
  }

  async save(record: RequestRecord): Promise<RequestRecord> {
    const current = this.state.requests.get(record.receipt.receiptId);
    if (!current) mediaStorageUnavailable();
    if (current.revision === record.revision) {
      current.receipt = jsonClone(record.receipt);
      current.revision++;
    }
    return this.decode(current);
  }

  private decode(record: StoredRequest): RequestRecord {
    return { ...jsonClone(record), submissionDeadline: new Date(record.submissionDeadline) };
  }
}
