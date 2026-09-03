import { Test } from '@nestjs/testing';
import { EmployeeTrackRecordService } from './employee-track-record.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('EmployeeTrackRecordService', () => {
  let service: EmployeeTrackRecordService;
  let prisma: any;

  beforeEach(async () => {
    prisma = { $queryRaw: jest.fn().mockResolvedValue([]) };
    const mod = await Test.createTestingModule({
      providers: [
        EmployeeTrackRecordService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = mod.get(EmployeeTrackRecordService);
  });

  it('空列表不打库', async () => {
    const result = await service.forEmployees([]);

    expect(result.size).toBe(0);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('一条 SQL 覆盖全部员工', async () => {
    prisma.$queryRaw.mockResolvedValue([
      { employeeId: 'emp-1', total: 200, success: 188 },
      { employeeId: 'emp-2', total: 3, success: 3 },
    ]);

    const result = await service.forEmployees(['emp-1', 'emp-2', 'emp-3']);

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(result.get('emp-1')).toEqual({
      totalExecutions: 200,
      successRate: 94,
    });
    expect(result.get('emp-2')).toEqual({
      totalExecutions: 3,
      successRate: 100,
    });
    // 没有执行记录的员工不在结果里，由调用方补零值
    expect(result.has('emp-3')).toBe(false);
  });

  it('新上架员工返回零值 + null 成功率，而不是 0%', async () => {
    const record = await service.forEmployee('emp-new');

    expect(record).toEqual({ totalExecutions: 0, successRate: null });
  });
});
