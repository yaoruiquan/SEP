import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<Request & { requestId?: string }>();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const raw = exception instanceof HttpException ? exception.getResponse() : 'Internal server error';
    const message = typeof raw === 'object' && raw !== null && 'message' in raw ? (raw as { message: unknown }).message : raw;
    response.status(status).json({ statusCode: status, message, requestId: request.requestId || response.getHeader('x-request-id'), timestamp: new Date().toISOString(), path: request.originalUrl });
  }
}
