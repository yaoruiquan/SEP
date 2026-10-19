import { CallHandler, ExecutionContext, HttpException, Injectable, NestInterceptor } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Observable, catchError, concatMap, defer, from, map, mergeMap, throwError } from 'rxjs';
import { KnowledgeAuditAction, KnowledgeAuditEvent, KnowledgeTelemetryService,
  knowledgeAuditId, knowledgeAuditResultCode } from './knowledge-telemetry.service';

const OPERATIONS: Record<string, Record<string, KnowledgeAuditAction>> = {
  SearchController: { search: 'KNOWLEDGE_SEARCH', getSource: 'KNOWLEDGE_SOURCE_READ' },
  KnowledgeController: { create: 'KNOWLEDGE_BASE_CREATE', update: 'KNOWLEDGE_BASE_UPDATE',
    delete: 'KNOWLEDGE_BASE_DELETE', createGrant: 'KNOWLEDGE_GRANT_CREATE',
    revokeMemberGrant: 'KNOWLEDGE_GRANT_REVOKE', reindex: 'KNOWLEDGE_OPERATION_RETIRED',
    deleteGrant: 'KNOWLEDGE_OPERATION_RETIRED' },
  DocumentController: { uploadDocument: 'KNOWLEDGE_DOCUMENT_UPLOAD', uploadVersion: 'KNOWLEDGE_DOCUMENT_VERSION_UPLOAD',
    reprocessDocument: 'KNOWLEDGE_DOCUMENT_RETRY', deleteDocument: 'KNOWLEDGE_DOCUMENT_DELETE' },
  KnowledgeTestController: { testSearch: 'KNOWLEDGE_TEST_SEARCH', batchReprocess: 'KNOWLEDGE_OPERATION_RETIRED' },
  TextChunkController: { createTextChunk: 'KNOWLEDGE_OPERATION_RETIRED',
    updateTextChunk: 'KNOWLEDGE_OPERATION_RETIRED', deleteTextChunk: 'KNOWLEDGE_OPERATION_RETIRED' },
};

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

@Injectable()
export class KnowledgeTelemetryInterceptor implements NestInterceptor {
  constructor(private readonly telemetry: KnowledgeTelemetryService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const controller = context.getClass().name;
    const action = OPERATIONS[controller]?.[context.getHandler().name];
    if (!action || (context.getType && context.getType() !== 'http')) return next.handle();
    const http = context.switchToHttp();
    const request = http.getRequest();
    const response = http.getResponse();
    const actorId = knowledgeAuditId(request.user?.id);
    if (!actorId) return next.handle();
    const started = performance.now();
    // The global request ID accepts client headers; use a server-generated ID on audited routes.
    const requestId = randomUUID();
    request.requestId = requestId;
    response.setHeader('x-request-id', requestId);
    const params = object(request.params);
    const documentRoute = controller === 'DocumentController';
    const ids = {
      knowledgeBaseId: knowledgeAuditId(documentRoute || controller === 'SearchController' || controller === 'TextChunkController'
        ? params.knowledgeBaseId : params.id),
      documentId: documentRoute ? knowledgeAuditId(params.id) : undefined,
      sourceId: action === 'KNOWLEDGE_SOURCE_READ' ? knowledgeAuditId(params.sourceId) : undefined,
      targetMemberId: action === 'KNOWLEDGE_GRANT_REVOKE' ? knowledgeAuditId(params.memberId) : undefined,
    };
    return from(this.telemetry.resolveActor(actorId)).pipe(mergeMap(actor => {
      const event = (statusCode: number, data: unknown, code?: unknown): KnowledgeAuditEvent => {
        const result = object(data);
        const search = action === 'KNOWLEDGE_SEARCH' || action === 'KNOWLEDGE_TEST_SEARCH';
        const knowledgeBaseId = ids.knowledgeBaseId ?? (action === 'KNOWLEDGE_BASE_CREATE' ? knowledgeAuditId(result.id) : undefined);
        const documentId = ids.documentId ?? (action === 'KNOWLEDGE_DOCUMENT_UPLOAD' ? knowledgeAuditId(result.documentId) : undefined);
        return { action, ...ids, knowledgeBaseId, documentId,
          resourceId: ids.sourceId ?? documentId ?? knowledgeBaseId,
          versionId: knowledgeAuditId(result.versionId),
          statusCode, resultCode: knowledgeAuditResultCode(code ?? (search ? result.status : undefined), statusCode),
          requestId, durationMs: Math.max(0, performance.now() - started),
          ...(search ? { searchId: knowledgeAuditId(result.searchId),
            count: typeof result.count === 'number' ? result.count : typeof result.hitCount === 'number' ? result.hitCount : undefined,
            actualStrategy: result.actualStrategy === 'HYBRID' || result.actualStrategy === 'LEXICAL' ? result.actualStrategy : null,
            degraded: typeof result.degraded === 'boolean' ? result.degraded : undefined,
            partial: typeof result.partial === 'boolean' ? result.partial : undefined } : {}),
        };
      };
      return defer(() => next.handle()).pipe(
        concatMap(result => from(this.telemetry.record(actor, event(response.statusCode ?? 200, result)))
          .pipe(map(() => result), catchError(() => from([result])))),
        catchError(error => {
          const status = error instanceof HttpException ? error.getStatus() : 500;
          const code = error instanceof HttpException ? object(error.getResponse()).code : undefined;
          return from(this.telemetry.record(actor, event(status, undefined, code)))
            .pipe(mergeMap(() => throwError(() => error)), catchError(() => throwError(() => error)));
        }),
      );
    }));
  }
}
