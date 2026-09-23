import { Test, TestingModule } from '@nestjs/testing';
import { AlertingService } from './alerting.service';
import { MonitoringService } from './monitoring.service';
import { PrismaService } from '../../../prisma/prisma.service';

describe('AlertingService', () => {
  let service: AlertingService;
  let monitoringService: MonitoringService;
  let prismaService: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AlertingService,
        MonitoringService,
        {
          provide: PrismaService,
          useValue: {
            enterprise: {
              findMany: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<AlertingService>(AlertingService);
    monitoringService = module.get<MonitoringService>(MonitoringService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  describe('checkMetrics', () => {
    it('应该在错误率过高时触发告警', async () => {
      // 模拟高错误率
      monitoringService.recordRequest(500, 100, '/api/test', 'GET', 'Error');
      monitoringService.recordRequest(500, 100, '/api/test', 'GET', 'Error');
      monitoringService.recordRequest(200, 100, '/api/test', 'GET');

      const sendAlertSpy = jest.spyOn(service as any, 'sendAlert');
      await service.checkMetrics();

      expect(sendAlertSpy).toHaveBeenCalled();
    });

    it('错误率正常时不应该触发告警', async () => {
      // 模拟正常错误率
      monitoringService.recordRequest(200, 100, '/api/test', 'GET');
      monitoringService.recordRequest(200, 100, '/api/test', 'GET');
      monitoringService.recordRequest(200, 100, '/api/test', 'GET');

      const sendAlertSpy = jest.spyOn(service as any, 'sendAlert');
      await service.checkMetrics();

      expect(sendAlertSpy).not.toHaveBeenCalled();
    });
  });

  describe('checkBalances', () => {
    it('应该检查余额不足的企业', async () => {
      const mockEnterprises = [
        {
          id: 'ent-1',
          name: '测试企业',
          wallet: { balance: 50 },
        },
      ];

      (prismaService.enterprise.findMany as jest.Mock).mockResolvedValue(
        mockEnterprises
      );

      const sendAlertSpy = jest.spyOn(service as any, 'sendAlert');
      await service.checkBalances();

      expect(prismaService.enterprise.findMany).toHaveBeenCalled();
      expect(sendAlertSpy).toHaveBeenCalledWith(
        'balance',
        expect.any(String),
        expect.stringContaining('测试企业'),
        'warning'
      );
    });
  });

  describe('sendTestAlert', () => {
    it('应该发送测试告警', async () => {
      const sendAlertSpy = jest.spyOn(service as any, 'sendAlert');
      await service.sendTestAlert();

      expect(sendAlertSpy).toHaveBeenCalledWith(
        'test',
        '测试告警',
        expect.any(String),
        'info'
      );
    });
  });

  describe('告警去重', () => {
    it('应该在冷却期内防止重复告警', async () => {
      // 触发第一次告警
      monitoringService.recordRequest(500, 100, '/api/test', 'GET', 'Error');
      monitoringService.recordRequest(500, 100, '/api/test', 'GET', 'Error');

      const sendWeChatAlertSpy = jest.spyOn(service as any, 'sendWeChatAlert').mockResolvedValue(undefined);
      
      await service.checkMetrics();
      expect(sendWeChatAlertSpy).toHaveBeenCalledTimes(1);

      // 立即再次触发（应该被去重）
      await service.checkMetrics();
      expect(sendWeChatAlertSpy).toHaveBeenCalledTimes(1); // 仍然是 1 次
    });
  });
});
