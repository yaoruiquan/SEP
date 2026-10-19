import { CallHandler, ExecutionContext, InternalServerErrorException } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { KnowledgeTelemetryInterceptor } from './knowledge-telemetry.interceptor';

describe('KnowledgeTelemetryInterceptor', () => {
  const telemetry: any = { resolveActor: jest.fn(), record: jest.fn() };
  let interceptor: KnowledgeTelemetryInterceptor;

  beforeEach(() => {
    jest.clearAllMocks();
    telemetry.resolveActor.mockResolvedValue({ actorId: 'user-1', enterpriseId: 'ent-1', memberId: 'member-1' });
    telemetry.record.mockResolvedValue(undefined);
    interceptor = new KnowledgeTelemetryInterceptor(telemetry);
  });

  function context(controller: string, handler: string, request: any = {}, response: any = { statusCode: 200, setHeader: jest.fn() }) {
    request.user = { id: 'user-1' };
    return { getType: () => 'http', getClass: () => ({ name: controller }), getHandler: () => ({ name: handler }),
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }) } as unknown as ExecutionContext;
  }

  it('records only safe search result metadata and replaces untrusted request IDs', async () => {
    const request: any = { requestId: 'attacker-value', body: { query: 'confidential' } };
    const response: any = { statusCode: 200, setHeader: jest.fn() };
    const next = { handle: () => of({ searchId: 'search-1', status: 'MATCHED', count: 1,
      actualStrategy: 'HYBRID', degraded: false, partial: true, results: [{ content: 'private text' }] }) } as CallHandler;
    await lastValueFrom(interceptor.intercept(context('SearchController', 'search', request, response), next));
    const event = telemetry.record.mock.calls[0][1];
    expect(request.requestId).not.toBe('attacker-value');
    expect(response.setHeader).toHaveBeenCalledWith('x-request-id', request.requestId);
    expect(event).toMatchObject({ action: 'KNOWLEDGE_SEARCH', statusCode: 200, resultCode: 'MATCHED',
      searchId: 'search-1', count: 1, actualStrategy: 'HYBRID', degraded: false, partial: true });
    expect(JSON.stringify(event)).not.toMatch(/confidential|private text/);
  });

  it('records a safe failure code then preserves the original exception', async () => {
    const next = { handle: () => throwError(() => new InternalServerErrorException({
      code: 'INTERNAL_ERROR', message: 'sensitive database details',
    })) } as CallHandler;
    await expect(lastValueFrom(interceptor.intercept(context('DocumentController', 'deleteDocument', {
      params: { knowledgeBaseId: 'kb-1', id: 'doc-1' },
    }), next))).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(telemetry.record.mock.calls[0][1]).toMatchObject({ action: 'KNOWLEDGE_DOCUMENT_DELETE',
      statusCode: 500, resultCode: 'INTERNAL_ERROR', knowledgeBaseId: 'kb-1', documentId: 'doc-1' });
    expect(JSON.stringify(telemetry.record.mock.calls[0])).not.toContain('sensitive database details');
  });

  it('does not allow telemetry errors to turn a committed operation into a failure', async () => {
    telemetry.record.mockRejectedValue(new Error('audit unavailable'));
    await expect(lastValueFrom(interceptor.intercept(context('KnowledgeController', 'create', {}),
      { handle: () => of({ id: 'kb-1' }) } as CallHandler))).resolves.toEqual({ id: 'kb-1' });
  });

  it('leaves untracked controller handlers untouched', async () => {
    await expect(lastValueFrom(interceptor.intercept(context('KnowledgeController', 'list'),
      { handle: () => of([]) } as CallHandler))).resolves.toEqual([]);
    expect(telemetry.resolveActor).not.toHaveBeenCalled();
  });

  it.each([
    ['UnrelatedController', 'search', 'http'],
    ['KnowledgeController', 'list', 'http'],
    ['SearchController', 'search', 'rpc'],
    ['SearchController', 'getSource', 'ws'],
  ])('never accesses HTTP for %s.%s on %s', async (controller, handler, type) => {
    const switchToHttp = jest.fn(() => { throw new Error('HTTP must not be accessed'); });
    const ctx = { getType: () => type, getClass: () => ({ name: controller }),
      getHandler: () => ({ name: handler }), switchToHttp } as unknown as ExecutionContext;
    const stream = of({ untouched: true });
    const next = { handle: jest.fn(() => stream) };
    const result = interceptor.intercept(ctx, next);
    expect(result).toBe(stream);
    await expect(lastValueFrom(result)).resolves.toEqual({ untouched: true });
    expect(switchToHttp).not.toHaveBeenCalled();
    expect(telemetry.resolveActor).not.toHaveBeenCalled();
    expect(telemetry.record).not.toHaveBeenCalled();
    expect(next.handle).toHaveBeenCalledTimes(1);
  });

  it('preserves the original business error when failure auditing is also unavailable', async () => {
    telemetry.record.mockRejectedValue(new Error('audit outage'));
    const error = new InternalServerErrorException('original failure');
    await expect(lastValueFrom(interceptor.intercept(context('SearchController', 'search'),
      { handle: () => throwError(() => error) }))).rejects.toBe(error);
    expect(telemetry.record).toHaveBeenCalledTimes(1);
  });
});
