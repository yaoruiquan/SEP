import { TASK_STEP_STATUS } from '@prisma/client';
import { parseHandoff, seedsFromPlanJson, STEP_STATUS_FROM_DB, STEP_STATUS_TO_DB } from './task-step-mapper';

describe('task-step-mapper', () => {
  it('步骤状态双向映射是一一对应的', () => {
    for (const [lower, upper] of Object.entries(STEP_STATUS_TO_DB)) {
      expect(STEP_STATUS_FROM_DB[upper]).toBe(lower);
    }
  });

  describe('parseHandoff', () => {
    it('脏数据一律当空处理，不抛异常', () => {
      expect(parseHandoff(null)).toEqual([]);
      expect(parseHandoff('not an array')).toEqual([]);
      expect(parseHandoff({ fromStepKey: 'step-1' })).toEqual([]);
      expect(parseHandoff([null, 42, { nope: true }])).toEqual([]);
    });

    it('保留形状正确的条目', () => {
      const entry = {
        fromStepKey: 'step-1',
        fromStepTitle: '调研',
        fromEmployeeName: '市场调研员',
        excerpt: '摘要',
        chars: 2,
      };
      expect(parseHandoff([entry])).toEqual([entry]);
    });
  });

  describe('seedsFromPlanJson', () => {
    const step = (over: Record<string, unknown> = {}) => ({
      id: 'step-1',
      order: 1,
      title: '竞品调研',
      description: '查三家竞品',
      employee: { id: 'emp1', name: '市场调研员', avatar: 'https://x/a.png' },
      capability: { id: 'cap1', name: '网页检索' },
      dependsOn: [],
      rationale: '需要外部数据',
      estimatedSeconds: 120,
      status: 'queued',
      ...over,
    });

    it('非数组返回空', () => {
      expect(seedsFromPlanJson(null)).toEqual([]);
      expect(seedsFromPlanJson({})).toEqual([]);
    });

    it('展开正常步骤', () => {
      const [seed] = seedsFromPlanJson([step()]);
      expect(seed).toMatchObject({
        stepKey: 'step-1',
        order: 1,
        title: '竞品调研',
        employeeId: 'emp1',
        employeeName: '市场调研员',
        employeeAvatar: 'https://x/a.png',
        capabilityId: 'cap1',
        capabilityName: '网页检索',
        estimatedSeconds: 120,
        status: TASK_STEP_STATUS.QUEUED,
      });
    });

    it('丢掉没有员工或能力的步骤 —— 留下来只会变成必然失败的行', () => {
      const seeds = seedsFromPlanJson([
        step({ employee: {} }),
        step({ id: 'step-2', capability: {} }),
        step({ id: 'step-3' }),
      ]);
      expect(seeds.map((seed) => seed.stepKey)).toEqual(['step-3']);
    });

    it('已完成的步骤保留产出，运行中/失败的回到排队', () => {
      const seeds = seedsFromPlanJson([
        step({ id: 'step-1', status: 'completed', output: '竞品A 89 元' }),
        step({ id: 'step-2', status: 'running', output: '半截' }),
        step({ id: 'step-3', status: 'failed' }),
        step({ id: 'step-4', status: 'skipped' }),
      ]);

      expect(seeds[0]).toMatchObject({ status: TASK_STEP_STATUS.COMPLETED, output: '竞品A 89 元' });
      expect(seeds[1].status).toBe(TASK_STEP_STATUS.QUEUED);
      expect(seeds[2].status).toBe(TASK_STEP_STATUS.QUEUED);
      expect(seeds[3].status).toBe(TASK_STEP_STATUS.SKIPPED);
    });

    it('缺字段时用兜底值而不是崩掉，并按下标补 stepKey/order', () => {
      const [seed] = seedsFromPlanJson([
        { employee: { id: 'emp1' }, capability: { id: 'cap1' } },
      ]);
      expect(seed).toMatchObject({
        stepKey: 'step-1',
        order: 1,
        title: '未命名步骤',
        description: '',
        employeeName: '未知员工',
        employeeAvatar: null,
        capabilityName: '未知能力',
        dependsOn: [],
        estimatedSeconds: 0,
      });
    });

    it('dependsOn 里的非字符串被过滤掉', () => {
      const [seed] = seedsFromPlanJson([step({ dependsOn: ['step-0', 7, null, 'step-x'] })]);
      expect(seed.dependsOn).toEqual(['step-0', 'step-x']);
    });
  });
});
