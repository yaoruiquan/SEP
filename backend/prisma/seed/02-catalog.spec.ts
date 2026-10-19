import fs = require('fs');
import { PrismaClient } from '@prisma/client';
import { backfillFunctionalCategories, seedCatalog } from './02-catalog';
import { employeeDisplayName } from '../employee-display-names';

describe('Catalog display-name compatibility', () => {
  const historical = ['国内电商运营专家', '直播电商增长教练', '私域复购运营师',
    '电商投放优化师', '商品内容与详情页策划', '电商售后与退货专员'];

  afterEach(() => jest.restoreAllMocks());

  it.each(['historical', 'renamed'])('reuses %s employee IDs without duplicating or restoring old names', async mode => {
    const existsSync = fs.existsSync;
    const readFileSync = fs.readFileSync;
    jest.spyOn(fs, 'existsSync').mockImplementation(file =>
      String(file).includes('.agency-agents') || existsSync(file));
    jest.spyOn(fs, 'readFileSync').mockImplementation(((file, options) =>
      String(file).includes('.agency-agents')
        ? '---\nname: Test skill\ndescription: Test description\n---\nTest content'
        : readFileSync(file, options)) as typeof fs.readFileSync);
    const rows = historical.map((name, index) => ({ id: `stable-${index}`,
      name: mode === 'historical' ? name : employeeDisplayName(name), status: 'APPROVED' }));
    const tx = {
      capability: { findFirst: jest.fn(async () => ({ id: 'skill' })), update: jest.fn(async () => ({ id: 'skill' })) },
      digitalEmployee: {
        findMany: jest.fn(async ({ where }) => rows.filter(row => where.name.in.includes(row.name))),
        update: jest.fn(async ({ where, data }) => {
          const row = rows.find(item => item.id === where.id)!;
          Object.assign(row, data);
          return row;
        }),
        create: jest.fn(),
      },
      employeeCapabilityBinding: { createMany: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn(async input => typeof input === 'function' ? input(tx) : Promise.all(input)),
      digitalEmployee: { findMany: jest.fn(async () => []) },
    } as unknown as PrismaClient;
    await seedCatalog(prisma, 'contributor');
    await seedCatalog(prisma, 'contributor');
    expect(tx.digitalEmployee.create).not.toHaveBeenCalled();
    expect(rows.map(row => row.id)).toEqual(historical.map((_, index) => `stable-${index}`));
    expect(rows.map(row => row.name)).toEqual(historical.map(employeeDisplayName));
    expect(tx.digitalEmployee.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { name: { in: ['商品内容与详情页策划', '商品文案策划'] } },
    }));
  });

  it('still recognizes renamed historical categories', async () => {
    const update = jest.fn(async () => ({}));
    const prisma = {
      digitalEmployee: { findMany: jest.fn(async () => [{ id: 'douyin', name: '抖音运营顾问' }]), update },
      $transaction: jest.fn(async input => Promise.all(input)),
    } as unknown as PrismaClient;
    expect(await backfillFunctionalCategories(prisma)).toEqual([]);
    expect(update).toHaveBeenCalledWith({ where: { id: 'douyin' }, data: { functionalCategory: 'MARKETING_GROWTH' } });
  });
});
