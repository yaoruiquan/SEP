import { collectDownstream, pickNextRunnable, type DependencyNode } from './task-dependency';

const node = (over: Partial<DependencyNode> & Pick<DependencyNode, 'stepKey' | 'order'>): DependencyNode => ({
  dependsOn: [],
  settled: false,
  queued: true,
  ...over,
});

describe('pickNextRunnable', () => {
  it('按 order 取第一个无依赖的排队步骤', () => {
    const picked = pickNextRunnable([
      node({ stepKey: 'step-2', order: 2 }),
      node({ stepKey: 'step-1', order: 1 }),
    ]);
    expect(picked?.stepKey).toBe('step-1');
  });

  it('依赖没完成的步骤不会被选中', () => {
    const picked = pickNextRunnable([
      node({ stepKey: 'step-1', order: 1, queued: false, settled: false }), // 正在跑
      node({ stepKey: 'step-2', order: 2, dependsOn: ['step-1'] }),
    ]);
    expect(picked).toBeUndefined();
  });

  it('依赖完成后放行下游', () => {
    const picked = pickNextRunnable([
      node({ stepKey: 'step-1', order: 1, queued: false, settled: true }),
      node({ stepKey: 'step-2', order: 2, dependsOn: ['step-1'] }),
    ]);
    expect(picked?.stepKey).toBe('step-2');
  });

  it('跳过一个被挡住的步骤，去跑另一条独立分支 —— 不能因为前面卡住就整体停摆', () => {
    const picked = pickNextRunnable([
      node({ stepKey: 'step-1', order: 1, queued: false, settled: false }),
      node({ stepKey: 'step-2', order: 2, dependsOn: ['step-1'] }),
      node({ stepKey: 'step-3', order: 3 }),
    ]);
    expect(picked?.stepKey).toBe('step-3');
  });

  it('依赖指向不存在的步骤时视为已满足，否则下游会永久卡住', () => {
    const picked = pickNextRunnable([node({ stepKey: 'step-2', order: 2, dependsOn: ['step-deleted'] })]);
    expect(picked?.stepKey).toBe('step-2');
  });

  it('暂停的步骤（queued=false）不会被选中', () => {
    const picked = pickNextRunnable([node({ stepKey: 'step-1', order: 1, queued: false })]);
    expect(picked).toBeUndefined();
  });
});

describe('collectDownstream', () => {
  const chain = [
    { stepKey: 'step-1', dependsOn: [] },
    { stepKey: 'step-2', dependsOn: ['step-1'] },
    { stepKey: 'step-3', dependsOn: ['step-2'] },
  ];

  it('包含自己', () => {
    expect([...collectDownstream(chain, 'step-3')]).toEqual(['step-3']);
  });

  it('沿链条传播到所有下游', () => {
    expect([...collectDownstream(chain, 'step-1')].sort()).toEqual(['step-1', 'step-2', 'step-3']);
  });

  it('多层扇出全部覆盖', () => {
    const fan = [
      { stepKey: 'a', dependsOn: [] },
      { stepKey: 'b', dependsOn: ['a'] },
      { stepKey: 'c', dependsOn: ['a'] },
      { stepKey: 'd', dependsOn: ['b', 'c'] },
      { stepKey: 'e', dependsOn: [] },
    ];
    expect([...collectDownstream(fan, 'a')].sort()).toEqual(['a', 'b', 'c', 'd']);
    expect([...collectDownstream(fan, 'e')]).toEqual(['e']);
  });

  it('依赖声明顺序在前、拓扑顺序在后时也能传播（不依赖数组顺序）', () => {
    const shuffled = [
      { stepKey: 'step-3', dependsOn: ['step-2'] },
      { stepKey: 'step-2', dependsOn: ['step-1'] },
      { stepKey: 'step-1', dependsOn: [] },
    ];
    expect([...collectDownstream(shuffled, 'step-1')].sort()).toEqual(['step-1', 'step-2', 'step-3']);
  });
});
