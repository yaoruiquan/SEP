import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { KnowledgeTelemetryService, knowledgeAuditResultCode } from './knowledge-telemetry.service';

describe('KnowledgeTelemetryService', () => {
  const prisma: any = {
    user: { findUnique: jest.fn() }, auditLog: { findMany: jest.fn(), count: jest.fn() },
    $queryRaw: jest.fn(),
  };
  const audit: any = { record: jest.fn() };
  const policy: any = { resolve: jest.fn() };
  const config: any = { get: jest.fn() };
  let service: KnowledgeTelemetryService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new KnowledgeTelemetryService(audit, policy, prisma, config);
  });

  it('only emits explicitly selected audit metadata and swallows audit failures', async () => {
    audit.record.mockRejectedValue(new Error('sensitive database detail'));
    const logger = jest.spyOn((service as any).logger, 'error').mockImplementation();
    await service.record({ actorId: 'user-1', enterpriseId: 'enterprise-1', memberId: 'member-1' }, {
      action: 'KNOWLEDGE_SEARCH', statusCode: 200, resultCode: 'MATCHED', requestId: 'request-1',
      searchId: 'search-1', durationMs: 12, count: 2, actualStrategy: 'HYBRID', degraded: false, partial: false,
      // Unknown metadata must never reach AuditService.
      query: 'private prompt', content: 'private source', filename: 'secret.pdf', token: 'secret',
    } as any);
    const record = audit.record.mock.calls[0][0];
    expect(record.metadata).toEqual({ memberId: 'member-1', knowledgeBaseId: null, documentId: null,
      versionId: null, sourceId: null, targetMemberId: null, statusCode: 200, resultCode: 'MATCHED',
      requestId: 'request-1', searchId: 'search-1', durationMs: 12, count: 2, actualStrategy: 'HYBRID',
      degraded: false, partial: false });
    expect(JSON.stringify(record)).not.toMatch(/private prompt|private source|secret\.pdf|sensitive database detail/);
    expect(service.getDiagnostics().auditWriteFailures).toBe(1);
    expect(logger).toHaveBeenCalledWith('KNOWLEDGE_AUDIT_WRITE_FAILED');
  });

  it('rechecks platform ADMIN from the database instead of request claims', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'USER' });
    await expect(service.getMetrics('user-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'user-1' }, select: { role: true } });
    expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
  });

  it('returns a safe service error when metrics storage is unavailable', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'ADMIN' });
    prisma.auditLog.findMany.mockRejectedValue(new Error('sensitive database detail'));
    const logger = jest.spyOn((service as any).logger, 'error').mockImplementation();
    await expect(service.getMetrics('admin-1')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(logger).toHaveBeenCalledWith('KNOWLEDGE_METRICS_READ_FAILED');
    expect(logger.mock.calls.flat().join(' ')).not.toContain('sensitive database detail');
    expect(service.getDiagnostics().metricsReadFailures).toBe(1);
  });

  it('bounds audit codes to a safe allowlist', () => {
    expect(knowledgeAuditResultCode('MATCHED', 200)).toBe('MATCHED');
    expect(knowledgeAuditResultCode('raw user query', 500)).toBe('INTERNAL_ERROR');
    expect(knowledgeAuditResultCode(undefined, 429)).toBe('RATE_LIMITED');
  });

  it('reports sampled metrics and response-only alerts without model health calls', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'ADMIN' });
    prisma.auditLog.findMany.mockResolvedValue([
      { action: 'KNOWLEDGE_SEARCH', result: 'SUCCESS', metadata: { statusCode: 200,
        resultCode: 'NO_MATCH', durationMs: 90, degraded: true, partial: true } },
    ]);
    prisma.auditLog.count.mockResolvedValue(10_001);
    prisma.$queryRaw
      .mockResolvedValueOnce([{ pending: 1n, running: 0n, due: 1n, expiredLeases: 0n, failed: 0n, done: 2n, oldestPendingAt: new Date(Date.now() - 1000) }])
      .mockResolvedValueOnce([{ stage: 'PARSING', count: 1n }])
      .mockResolvedValueOnce([{ pendingVersions: 2n, oldestExpiredAt: new Date(Date.now() - 3_600_001) }])
      .mockResolvedValueOnce([{ documents: 3n, versions: 4n, originalBytes: 100n, chunks: 5n,
        vectorChunks: 4n, lexicalChunks: 5n, chunkRelationBytes: 200n }]);
    const metrics = await service.getMetrics('admin-1');
    expect(metrics.window).toMatchObject({ maxEvents: 10_000, sampleSize: 1, totalEvents: 10_001, sampled: true });
    expect(metrics.search).toMatchObject({ requests: 1, noMatch: 1, p95Ms: 90, degraded: 1, partial: 1 });
    expect(metrics.cleanup.pendingVersions).toBe(2);
    expect(metrics.storage.physicalFileBytesMeasured).toBe(false);
    expect(metrics.alerting).toMatchObject({ delivery: 'RESPONSE_ONLY', externalNotifications: false, status: 'WARNING' });
    expect(config.get).toHaveBeenCalledWith('KNOWLEDGE_METRICS_SEARCH_P95_MS');
  });
});
