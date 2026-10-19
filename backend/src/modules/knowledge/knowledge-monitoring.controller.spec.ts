import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { KnowledgeMonitoringController } from './knowledge-monitoring.controller';

describe('KnowledgeMonitoringController', () => {
  it('forwards only the authenticated user ID; route has no body parameter', async () => {
    const telemetry: any = { getMetrics: jest.fn().mockResolvedValue({ generatedAt: 'now' }) };
    const controller = new KnowledgeMonitoringController(telemetry);
    await expect(controller.getMetrics({ user: { id: 'user-1' } })).resolves.toEqual({ generatedAt: 'now' });
    expect(telemetry.getMetrics).toHaveBeenCalledWith('user-1');
  });

  it.each([new ForbiddenException(), new ServiceUnavailableException()])(
    'does not invoke supplementary monitors if authorization or core metrics fails: %s', async error => {
      const telemetry: any = { getMetrics: jest.fn().mockRejectedValue(error) };
      const retention: any = { getStatus: jest.fn() };
      const limiter: any = { getStats: jest.fn() };
      const controller = new KnowledgeMonitoringController(telemetry, retention, limiter);
      // A forged request role cannot cause supplementary metric reads.
      const request = { user: { id: 'user-1', role: 'ADMIN' } };
      await expect(controller.getMetrics(request)).rejects.toBe(error);
      expect(telemetry.getMetrics).toHaveBeenCalledWith('user-1');
      expect(retention.getStatus).not.toHaveBeenCalled();
      expect(limiter.getStats).not.toHaveBeenCalled();
    },
  );

  it('awaits authorization before invoking supplementary monitors and merges their results', async () => {
    let authorize: (metrics: any) => void;
    const telemetry: any = { getMetrics: jest.fn(() => new Promise(resolve => { authorize = resolve; })) };
    const retention: any = { getStatus: jest.fn().mockResolvedValue({ pending: 2 }) };
    const counters = { search: { allowed: 3, limited: 1, unavailable: 0 } };
    const limiter: any = { getStats: jest.fn().mockReturnValue(counters) };
    const controller = new KnowledgeMonitoringController(telemetry, retention, limiter);
    const pending = controller.getMetrics({ user: { id: 'admin-1' } });
    expect(retention.getStatus).not.toHaveBeenCalled();
    expect(limiter.getStats).not.toHaveBeenCalled();
    authorize({ generatedAt: 'now' });
    await expect(pending).resolves.toEqual({ generatedAt: 'now', retention: { pending: 2 },
      rateLimits: { scope: 'PROCESS_LOCAL', counters } });
    expect(retention.getStatus).toHaveBeenCalledTimes(1);
    expect(limiter.getStats).toHaveBeenCalledTimes(1);
  });

  it('returns a controlled 503 when supplementary retention monitoring fails', async () => {
    const telemetry: any = { getMetrics: jest.fn().mockResolvedValue({}) };
    const retention: any = { getStatus: jest.fn().mockRejectedValue(new Error('private database details')) };
    const controller = new KnowledgeMonitoringController(telemetry, retention);
    await expect(controller.getMetrics({ user: { id: 'admin-1' } })).rejects.toMatchObject({
      status: 503, response: { code: 'KNOWLEDGE_METRICS_UNAVAILABLE', message: '知识库监控暂时不可用' },
    });
  });
});
