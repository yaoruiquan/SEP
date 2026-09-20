import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

    const rawBody = isRecord(raw) ? raw : undefined;
    const rawError = isRecord(rawBody?.error) ? rawBody.error : undefined;
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
      },
    });
  }
}
