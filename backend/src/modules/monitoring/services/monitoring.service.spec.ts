import { Test, TestingModule } from '@nestjs/testing';
import { MonitoringService } from './monitoring.service';

describe('MonitoringService', () => {
  let service: MonitoringService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MonitoringService],
    }).compile();

    service = module.get<MonitoringService>(MonitoringService);
  });

  afterEach(() => {
    service.reset();
  });

  describe('recordRequest', () => {
    it('应该正确记录成功请求', () => {
      service.recordRequest(200, 100, '/api/users', 'GET');

      const metrics = service.getCumulativeMetrics();
      expect(metrics.total).toBe(1);
      expect(metrics.success).toBe(1);
      expect(metrics.error).toBe(0);
    });

    it('应该正确记录客户端错误（4xx）', () => {
      service.recordRequest(404, 50, '/api/users/999', 'GET', 'Not found');

      const metrics = service.getCumulativeMetrics();
      expect(metrics.total).toBe(1);
      expect(metrics.success).toBe(0);
      expect(metrics.error).toBe(1);
      expect(metrics.clientError).toBe(1);
      expect(metrics.serverError).toBe(0);
    });

    it('应该正确记录服务器错误（5xx）', () => {
      service.recordRequest(500, 200, '/api/auth/login', 'POST', 'Internal error');

      const metrics = service.getCumulativeMetrics();
      expect(metrics.total).toBe(1);
      expect(metrics.success).toBe(0);
      expect(metrics.error).toBe(1);
      expect(metrics.serverError).toBe(1);
      expect(metrics.clientError).toBe(0);
    });

    it('应该记录错误详情', () => {
      service.recordRequest(500, 100, '/api/test', 'POST', 'Test error', 'TestAgent');

      const errors = service.getRecentErrors(10);
      expect(errors).toHaveLength(1);
      expect(errors[0].path).toBe('/api/test');
      expect(errors[0].statusCode).toBe(500);
      expect(errors[0].message).toBe('Test error');
    });
  });

  describe('getRequestMetrics', () => {
    it('应该返回 1 分钟窗口内的指标', () => {
      // 记录一些请求
      service.recordRequest(200, 100, '/api/test', 'GET');
      service.recordRequest(200, 150, '/api/test', 'GET');
      service.recordRequest(500, 200, '/api/test', 'POST', 'Error');

      const metrics = service.getRequestMetrics();
      expect(metrics.total).toBe(3);
      expect(metrics.success).toBe(2);
      expect(metrics.error).toBe(1);
      expect(metrics.errorRate).toBeCloseTo(1 / 3);
    });

    it('空窗口应该返回零值', () => {
      const metrics = service.getRequestMetrics();
      expect(metrics.total).toBe(0);
      expect(metrics.errorRate).toBe(0);
    });
  });

  describe('getResponseTimeMetrics', () => {
    it('应该正确计算响应时间统计', () => {
      const durations = [100, 200, 300, 400, 500];
      durations.forEach(d => {
        service.recordRequest(200, d, '/api/test', 'GET');
      });

      const metrics = service.getResponseTimeMetrics();
      expect(metrics.avg).toBe(300);
      expect(metrics.p50).toBe(300);
      expect(metrics.max).toBe(500);
    });

    it('空窗口应该返回零值', () => {
      const metrics = service.getResponseTimeMetrics();
      expect(metrics.p50).toBe(0);
      expect(metrics.p95).toBe(0);
      expect(metrics.avg).toBe(0);
    });
  });

  describe('getErrorRate', () => {
    it('应该正确计算错误率', () => {
      service.recordRequest(200, 100, '/api/test', 'GET');
      service.recordRequest(200, 100, '/api/test', 'GET');
      service.recordRequest(500, 100, '/api/test', 'POST', 'Error');

      const errorRate = service.getErrorRate();
      expect(errorRate).toBeCloseTo(1 / 3);
    });

    it('无请求时错误率应该为 0', () => {
      const errorRate = service.getErrorRate();
      expect(errorRate).toBe(0);
    });
  });

  describe('getAverageResponseTime', () => {
    it('应该正确计算平均响应时间', () => {
      service.recordRequest(200, 100, '/api/test', 'GET');
      service.recordRequest(200, 200, '/api/test', 'GET');
      service.recordRequest(200, 300, '/api/test', 'GET');

      const avg = service.getAverageResponseTime();
      expect(avg).toBe(200);
    });
  });

  describe('getRecentErrors', () => {
    it('应该返回最近的错误记录', () => {
      service.recordRequest(404, 100, '/api/test1', 'GET', 'Error 1');
      service.recordRequest(500, 100, '/api/test2', 'POST', 'Error 2');

      const errors = service.getRecentErrors(10);
      expect(errors).toHaveLength(2);
      expect(errors[0].message).toBe('Error 1');
      expect(errors[1].message).toBe('Error 2');
    });

    it('应该限制错误记录数量', () => {
      // 记录 150 个错误（超过 MAX_ERROR_RECORDS = 100）
      for (let i = 0; i < 150; i++) {
        service.recordRequest(500, 100, '/api/test', 'GET', `Error ${i}`);
      }

      const errors = service.getRecentErrors(200);
      expect(errors.length).toBeLessThanOrEqual(100);
    });
  });
});
