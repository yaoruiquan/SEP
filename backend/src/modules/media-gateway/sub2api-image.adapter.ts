import { HttpException, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { SETTING_KEYS } from 'shared';
import type { MediaRealQuoteRequest } from '../../shared/media-real.dto';
import { SettingService } from '../setting/setting.service';
import { inspectMediaPng } from './media-png';

const PricingSchema = z.object({
  object: z.literal('sub2api.image_pricing'), schema_version: z.literal(1), currency: z.literal('USD'),
  model: z.literal('gpt-image-2'), operation: z.enum(['generate', 'edit']), size: z.string(), n: z.number().int(),
  quality: z.enum(['low', 'medium', 'high']), billing_mode: z.enum(['image', 'per_request', 'token']),
  pricing_status: z.enum(['quoted', 'unavailable']), pricing_source: z.string().min(1),
  amount_usd: z.string().regex(/^\d+(?:\.\d{1,12})?$/).nullable(), pricing_version: z.string().min(1).max(128),
  effective_rate_multiplier: z.number().finite().nonnegative(),
  observed_at: z.string().datetime({ offset: true }), expires_at: z.string().datetime({ offset: true }),
});
export type Sub2apiImagePrice = z.infer<typeof PricingSchema>;
const UsageSchema = z.object({
  object: z.literal('sub2api.request_usage'), schema_version: z.literal(1), currency: z.literal('USD'),
  request_id: z.string().min(1).max(256), status: z.enum(['settled', 'pending']),
  model: z.string().nullable().optional(), actual_cost_usd: z.string().regex(/^\d+(?:\.\d{1,12})?$/).nullable(),
  image_count: z.number().int().nonnegative().nullable().optional(),
});
export type Sub2apiImageUsage = z.infer<typeof UsageSchema>;
export class ImageDispatchError extends HttpException {
  constructor(readonly requestId: string | null, readonly definitelyRejected: boolean) {
    super({ error: { code: definitelyRejected ? 'UPSTREAM_FAILED' : 'SUBMISSION_UNKNOWN', message: '图片上游执行未完成，请查询原请求' } }, 502);
  }
}
function unavailable(code = 'PRICE_UNAVAILABLE'): never {
  throw new HttpException({ error: { code, message: '图片上游合同暂不可核验，不能提交收费执行' } }, 503);
}
@Injectable()
export class Sub2apiImageAdapter {
  constructor(private readonly settings: SettingService) {}

  async pricing(input: MediaRealQuoteRequest): Promise<Sub2apiImagePrice> {
    const result = await this.call('/sub2api/images/pricing', {
      method: 'POST', body: JSON.stringify({ model: 'gpt-image-2', operation: input.operation,
        size: input.parameters.size, n: input.parameters.count, quality: input.parameters.quality }),
      headers: { 'Content-Type': 'application/json' },
    }, 15_000, 64 * 1024);
    const parsed = PricingSchema.safeParse(result.value);
    if (!parsed.success) unavailable();
    const price = parsed.data;
    if (price.model !== 'gpt-image-2' || price.operation !== input.operation || price.size !== input.parameters.size ||
      price.n !== input.parameters.count || price.quality !== input.parameters.quality || price.pricing_status !== 'quoted' ||
      price.billing_mode === 'token' || price.amount_usd === null || Date.parse(price.expires_at) <= Date.now() ||
      Date.parse(price.expires_at) > Date.now() + 120_000 || Date.parse(price.observed_at) > Date.now() + 5000 ||
      /fallback|default|unknown/i.test(price.pricing_source)) unavailable();
    return price;
  }

  async usage(requestId: string): Promise<Sub2apiImageUsage> {
    if (!/^[A-Za-z0-9_.:-]{1,256}$/.test(requestId)) unavailable('BILLING_PENDING');
    const result = await this.call(`/sub2api/usage?request_id=${encodeURIComponent(requestId)}`, { method: 'GET' }, 15_000, 64 * 1024);
    const parsed = UsageSchema.safeParse(result.value);
    if (!parsed.success || parsed.data.request_id !== requestId ||
      (parsed.data.status === 'settled' && (parsed.data.actual_cost_usd === null || parsed.data.model !== 'gpt-image-2' ||
        parsed.data.image_count == null || parsed.data.image_count < 1 || parsed.data.image_count > 4)) ||
      (parsed.data.status === 'pending' && parsed.data.actual_cost_usd !== null)) unavailable('BILLING_PENDING');
    return parsed.data;
  }

  async execute(input: MediaRealQuoteRequest, references: Buffer[], onRequestId?: (requestId: string) => Promise<void>): Promise<{ requestId: string; images: Buffer[] }> {
    let body: BodyInit; let headers: Record<string, string> = {};
    if (input.operation === 'generate') {
      body = JSON.stringify({ model: 'gpt-image-2', prompt: input.creativeBrief, n: input.parameters.count,
        size: input.parameters.size, quality: input.parameters.quality, response_format: 'b64_json' });
      headers = { 'Content-Type': 'application/json' };
    } else {
      if (!references.length || references.length !== input.referenceIds.length) unavailable('INVALID_REFERENCE');
      const form = new FormData();
      for (const [index, bytes] of references.entries()) {
        inspectMediaPng(bytes, 5 * 1024 * 1024);
        form.append('image[]', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), `reference-${index}.png`);
      }
      for (const [key, value] of Object.entries({ model: 'gpt-image-2', prompt: input.creativeBrief,
        n: String(input.parameters.count), size: input.parameters.size, quality: input.parameters.quality, response_format: 'b64_json' })) form.append(key, value);
      body = form;
    }
    const result = await this.call(`/images/${input.operation === 'generate' ? 'generations' : 'edits'}`, { method: 'POST', headers, body }, 180_000, 140 * 1024 * 1024, true, onRequestId);
    if (!result.requestId) throw new ImageDispatchError(null, false);
    const value = z.object({ data: z.array(z.object({ b64_json: z.string().min(1) })).min(1).max(4) }).safeParse(result.value);
    if (!value.success || value.data.data.length > input.parameters.count) throw new ImageDispatchError(result.requestId, false);
    const images: Buffer[] = [];
    try {
      for (const item of value.data.data) {
        if (item.b64_json.length > Math.ceil(25 * 1024 * 1024 / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(item.b64_json)) throw new Error();
        const bytes = Buffer.from(item.b64_json, 'base64');
        const dimensions = inspectMediaPng(bytes);
        const [width, height] = input.parameters.size.split('x').map(Number);
        if (dimensions.width !== width || dimensions.height !== height) throw new Error();
        images.push(bytes);
      }
    } catch { throw new ImageDispatchError(result.requestId, false); }
    return { requestId: result.requestId, images };
  }

  private async connection() {
    const [base, key] = await Promise.all([this.settings.getEffectiveValue(SETTING_KEYS.MEDIA_BASE_URL), this.settings.getEffectiveValue(SETTING_KEYS.MEDIA_API_KEY)]);
    try {
      const url = new URL(base ?? '');
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !key?.trim() || /[\r\n]/.test(key)) unavailable();
      // MEDIA_BASE_URL is a sub2api media connection, configured separately from chat.
      return { base: url.href.replace(/\/+$/, '').replace(/\/v1$/, '') + '/v1', key };
    } catch { unavailable(); }
  }

  private async call(path: string, options: RequestInit, timeout: number, maxBytes: number, dispatch = false, onRequestId?: (requestId: string) => Promise<void>): Promise<{ value: unknown; requestId: string | null }> {
    const connection = await this.connection();
    let requestId: string | null = null;
    try {
      const response = await fetch(connection.base + path, { ...options, headers: {
        ...options.headers, Authorization: `Bearer ${connection.key}`, Accept: 'application/json',
      }, redirect: 'error', signal: AbortSignal.timeout(timeout) });
      // sub2api bills by its client correlation ID; X-Request-ID may belong to the upstream.
      const clientId = response.headers.get('x-client-request-id');
      const rawId = clientId === null ? response.headers.get('x-request-id') : `client:${clientId}`;
      requestId = rawId && /^[A-Za-z0-9_.:-]{1,256}$/.test(rawId) && clientId !== '' ? rawId : null;
      if (requestId && onRequestId) {
        try { await onRequestId(requestId); }
        catch {
          await response.body?.cancel().catch(() => {});
          // Persistence failure cannot establish that upstream work was rejected.
          throw new ImageDispatchError(requestId, false);
        }
      }
      if (!response.ok) {
        await response.body?.cancel();
        // Gateway failures can include partial upstream work. Only explicit validation/auth rejection is definite.
        if (dispatch) throw new ImageDispatchError(requestId, [400, 401, 403, 404, 413, 422, 429].includes(response.status));
        unavailable(path.startsWith('/sub2api/usage') ? 'BILLING_PENDING' : 'PRICE_UNAVAILABLE');
      }
      if (!response.headers.get('content-type')?.includes('application/json') || !response.body) throw new Error();
      const reader = response.body.getReader(); const chunks: Buffer[] = []; let length = 0;
      try {
        while (true) {
          const part = await reader.read(); if (part.done) break;
          length += part.value.length; if (length > maxBytes) throw new Error(); chunks.push(Buffer.from(part.value));
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      return { value: JSON.parse(Buffer.concat(chunks).toString('utf8')), requestId };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (dispatch) throw new ImageDispatchError(requestId, false);
      unavailable(path.startsWith('/sub2api/usage') ? 'BILLING_PENDING' : 'PRICE_UNAVAILABLE');
    }
  }
}
