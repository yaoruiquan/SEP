import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, Optional, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { KnowledgeAccessPolicy } from './knowledge-access-policy';
import { KnowledgeRateLimitService, type KnowledgeRateLimitOperation } from './knowledge-rate-limit.service';
import { KnowledgeTelemetryService } from './knowledge-telemetry.service';

/** Scoped to SearchController, after KnowledgeAuthGuard. */
@Injectable()
export class KnowledgeRateLimitGuard implements CanActivate {
  constructor(private readonly policy: KnowledgeAccessPolicy, private readonly limiter: KnowledgeRateLimitService,
    @Optional() private readonly telemetry?: KnowledgeTelemetryService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request & { user?: { id?: unknown }; requestId?: string }>();
    // Express serves GET handlers for HEAD too; do not leave that route unlimited.
    const operation: KnowledgeRateLimitOperation | null = request.method === 'POST' ? 'search'
      : request.method === 'GET' || request.method === 'HEAD' ? 'source' : null;
    if (!operation) return true;
    const response = http.getResponse<Response>();
    response.setHeader('Cache-Control', 'no-store');
    if (typeof request.user?.id !== 'string' || !request.user.id) throw new UnauthorizedException();
    const started = performance.now();
    const reject = async (status: number, viewer: { enterpriseId: string | null; memberId: string | null }) => {
      request.requestId = randomUUID();
      response.setHeader('x-request-id', request.requestId);
      await this.recordRejection(request.user.id as string, viewer, operation, status, started, request.requestId);
    };
    let viewer: Awaited<ReturnType<KnowledgeAccessPolicy['resolve']>>;
    try { viewer = await this.policy.resolve(request.user.id); }
    catch (error) {
      const status = error instanceof HttpException ? error.getStatus() : 503;
      await reject(status, { enterpriseId: null, memberId: null });
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException({ code: 'KNOWLEDGE_SERVICE_UNAVAILABLE', message: '知识库权限检查暂时不可用' });
    }
    let result: Awaited<ReturnType<KnowledgeRateLimitService['consume']>>;
    try {
      result = await this.limiter.consume({ enterpriseId: viewer.enterpriseId, memberId: viewer.memberId }, operation);
    } catch (error) {
      await reject(503, viewer);
      throw error;
    }
    if (!result.allowed) {
      response.setHeader('Retry-After', String(result.retryAfterSeconds));
      await reject(429, viewer);
      throw new HttpException({
        code: 'KNOWLEDGE_RATE_LIMIT_EXCEEDED', message: 'Knowledge requests are too frequent. Please retry later.',
        retryAfterSeconds: result.retryAfterSeconds,
      }, HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }

  private async recordRejection(actorId: string, viewer: { enterpriseId: string | null; memberId: string | null },
    operation: KnowledgeRateLimitOperation, statusCode: number, started: number, requestId: string) {
    try {
      await this.telemetry?.record({ actorId, ...viewer }, {
        action: operation === 'search' ? 'KNOWLEDGE_SEARCH' : 'KNOWLEDGE_SOURCE_READ',
        statusCode, resultCode: statusCode === 429 ? 'RATE_LIMITED' : statusCode === 403 ? 'FORBIDDEN' : 'SERVICE_UNAVAILABLE',
        requestId, durationMs: performance.now() - started,
      });
    } catch { /* Audit outages must not replace the limiter's controlled response. */ }
  }
}
