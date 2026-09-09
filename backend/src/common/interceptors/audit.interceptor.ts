import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable, catchError, tap, throwError, from, mergeMap } from 'rxjs';
import { AuditService } from '../../modules/audit/audit.service';
import { EnterpriseContextService } from '../../modules/enterprise/enterprise-context.service';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SENSITIVE_KEYS = /password|token|secret|key|authorization|cookie/i;

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);
  constructor(private readonly audit: AuditService, private readonly context: EnterpriseContextService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = ctx.switchToHttp().getRequest<any>();
    if (!WRITE_METHODS.has(request.method) || request.user?.id === undefined || request.path.startsWith('/api/audit-logs')) return next.handle();
    const actorId = request.user.id as string;
    const action = `${request.method} ${request.route?.path ?? request.path}`;
    const metadata = this.redact({ query: request.query, params: request.params });
    return from(this.context.resolveOrNull(actorId)).pipe(
      mergeMap((resolved) => {
        const enterpriseId = resolved?.enterpriseId ?? null;
        const write = (result: string, summary?: string) => this.audit.record({ actorId, enterpriseId, action, resourceType: String(request.route?.path ?? request.path).split('/')[2] || 'unknown', resourceId: request.params?.id, result, summary, metadata }).catch((error) => this.logger.warn(`audit write failed: ${(error as Error).message}`));
        return next.handle().pipe(
          tap(() => void write('SUCCESS')),
          catchError((error) => { void write('FAILED', error?.message ? String(error.message).slice(0, 240) : 'request failed'); return throwError(() => error); }),
        );
      }),
    );
  }

  private redact(input: any): any {
    if (input === null || input === undefined) return input;
    if (Array.isArray(input)) return input.map((item) => this.redact(item));
    if (typeof input !== 'object') return input;
    return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, SENSITIVE_KEYS.test(key) ? '[REDACTED]' : this.redact(value)]));
  }
}
