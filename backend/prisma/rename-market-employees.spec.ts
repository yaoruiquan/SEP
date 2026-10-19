import { PrismaClient } from '@prisma/client';
import { renameMarketEmployees } from './rename-market-employees';

describe('Rename market employee data', () => {
  const original = { id: 'employee-1', name: '电商经营日报官', status: 'APPROVED',
    description: 'Existing description', systemPrompt: 'Existing prompt', avatar: '/existing.webp',
    annualPriceCNY: 100, updatedAt: new Date(0) };
  let row: typeof original;
  let tx: any;
  let prisma: PrismaClient;

  beforeEach(() => {
    row = { ...original };
    tx = {
      $executeRaw: jest.fn(),
      digitalEmployee: {
        findMany: jest.fn(async () => [{ ...row }]),
        updateMany: jest.fn(async ({ data }) => { row = { ...row, ...data }; return { count: 1 }; }),
      },
    };
    prisma = { $transaction: jest.fn(callback => callback(tx)) } as unknown as PrismaClient;
  });

  it('previews without writing', async () => {
    const report = await renameMarketEmployees(prisma);
    expect(report.changed).toBe(1);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.digitalEmployee.updateMany).not.toHaveBeenCalled();
    expect(row).toEqual(original);
  });

  it('writes only the name, scoped by ID and old name, without creating employees', async () => {
    const report = await renameMarketEmployees(prisma, true);
    expect(report.changed).toBe(1);
    expect(tx.digitalEmployee.updateMany).toHaveBeenCalledWith({
      where: { id: original.id, name: original.name, status: 'APPROVED' },
      data: { name: '店铺日报助手' },
    });
    expect(row).toEqual({ ...original, name: '店铺日报助手' });
    expect((await renameMarketEmployees(prisma, true)).changed).toBe(0);
    expect(tx.digitalEmployee.updateMany).toHaveBeenCalledTimes(1);
  });

  it('fails the transaction if the source changed or another field was modified', async () => {
    tx.digitalEmployee.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(renameMarketEmployees(prisma, true)).rejects.toThrow('员工已变化');
    tx.digitalEmployee.updateMany.mockImplementationOnce(async ({ data }) => {
      row = { ...row, ...data, systemPrompt: 'Unexpected change' };
      return { count: 1 };
    });
    await expect(renameMarketEmployees(prisma, true)).rejects.toThrow('非名称字段');
  });
});
