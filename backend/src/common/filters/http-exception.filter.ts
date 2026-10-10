import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeRateLimit(value: unknown): Record<string, string | number> | undefined {
  if (!isRecord(value)) return undefined;
  const result: Record<string, string | number> = {};
  for (const field of ['rule', 'dimension']) {
    if (typeof value[field] === 'string') result[field] = value[field];
  }
  // resetAt is Unix milliseconds, not an upstream date or a seconds timestamp.
  for (const field of ['limit', 'windowMs', 'count', 'retryAfterSeconds', 'resetAt']) {
    const number = value[field];
    if (typeof number === 'number' && Number.isSafeInteger(number) && number >= 0) {
      result[field] = number;
    }
  }
  return Object.keys(result).length ? result : undefined;
}

function waitingSeconds(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
  const seconds = Math.ceil(value);
  return Number.isSafeInteger(seconds) ? seconds : undefined;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<Request & { requestId?: string }>();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const raw = exception instanceof HttpException ? exception.getResponse() : 'Internal server error';
    const message = typeof raw === 'object' && raw !== null && 'message' in raw ? (raw as { message: unknown }).message : raw;
    const requestId = request.requestId || response.getHeader('x-request-id');
    const rawBody = isRecord(raw) ? raw : undefined;

    if (status === HttpStatus.TOO_MANY_REQUESTS && response.getHeader('Retry-After') === undefined) {
      let retryAfterSeconds = waitingSeconds(rawBody?.retryAfterSeconds);
      if (retryAfterSeconds === undefined) {
        const namedWaits = Object.entries(response.getHeaders()).flatMap(([name, value]) => {
          if (!/^retry-after-.+$/i.test(name)) return [];
          const seconds = typeof value === 'number' ? waitingSeconds(value)
            : typeof value === 'string' && /^\d+$/.test(value.trim())
              ? waitingSeconds(Number(value)) : undefined;
          return seconds === undefined ? [] : [seconds];
        });
        retryAfterSeconds = namedWaits.length ? Math.max(...namedWaits) : undefined;
      }
      response.setHeader('Retry-After', String(retryAfterSeconds ?? 60));
    }

    const body = {
      statusCode: status,
      message,
      requestId,
      timestamp: new Date().toISOString(),
      path: request.originalUrl,
    };

    // Keep the existing business API envelope unchanged outside the gateway.
    const path = request.originalUrl.split('?')[0];
    if (path !== '/api/gateway' && !path.startsWith('/api/gateway/')) {
      response.status(status).json(body);
      return;
    }

    const rawError = isRecord(rawBody?.error) ? rawBody.error : undefined;
    const rateLimit = safeRateLimit(rawError?.rateLimit);
    const errors = Array.isArray(rawBody?.errors)
      ? rawBody.errors
          .filter((error): error is { field: string; message: string } =>
            isRecord(error) && typeof error.field === 'string' && typeof error.message === 'string',
          )
          .map(({ field, message }) => ({ field, message }))
      : undefined;
    const defaultMessage = status >= 500 ? 'Internal server error' : 'Request failed';
    const outerMessage = typeof message === 'string'
      ? message
      : Array.isArray(message)
        ? message.filter((entry): entry is string => typeof entry === 'string')
        : undefined;
    const readableMessage = (Array.isArray(outerMessage) ? outerMessage.join('; ') : outerMessage) || defaultMessage;
    const validationMessage = errors?.length
      ? `${readableMessage}: ${errors.map(({ field, message }) => field ? `${field}: ${message}` : message).join('; ')}`
      : readableMessage;
    const errorMessage = typeof rawError?.message === 'string' && rawError.message
      ? rawError.message
      : validationMessage;

    response.status(status).json({
      ...body,
      // Never use the whole upstream response as a message: it can contain private metadata.
      message: outerMessage ?? errorMessage,
      ...(errors !== undefined ? { errors } : {}),
      error: {
        message: errorMessage,
        type: typeof rawError?.type === 'string' && rawError.type
          ? rawError.type
          : status >= 500 ? 'server_error' : 'invalid_request_error',
        code: typeof rawError?.code === 'string' ? rawError.code : errors?.length ? 'INVALID_PARAMETER' : null,
        param: typeof rawError?.param === 'string' || rawError?.param === null
          ? rawError.param
          : errors?.[0]?.field || null,
        requestId,
        ...(rawError?.source === 'platform' || rawError?.source === 'upstream'
          ? { source: rawError.source } : {}),
        ...(rateLimit !== undefined ? { rateLimit } : {}),
      },
    });
  }
}
