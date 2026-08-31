/**
 * 依赖图上的两个纯函数。
 *
 * 单独成文件是为了能不碰数据库地测它们 —— 「下一个该跑谁」和「重跑要连带
 * 重置谁」是这套引擎里最容易出错、也最难在集成测试里覆盖到的两处判断。
 */

export interface DependencyNode {
  stepKey: string;
  order: number;
  dependsOn: string[];
  /** 是否已经产出（completed / skipped 都算「依赖已满足」） */
  settled: boolean;
  /** 是否在排队等着被执行 */
  queued: boolean;
}

/**
 * 下一个可执行步骤：自己在排队，且所有依赖都已 settled。
 *
 * 依赖指向一个不存在的 stepKey 时视为已满足 —— 计划被编辑过（删掉了某步）时
 * 若按「未满足」处理，整条下游链会永久卡在候场中，而界面上看不出原因。
 */
export function pickNextRunnable<T extends DependencyNode>(nodes: T[]): T | undefined {
  const byKey = new Map(nodes.map((node) => [node.stepKey, node]));
  return [...nodes]
    .filter((node) => node.queued)
    .sort((left, right) => left.order - right.order)
    .find((node) =>
      node.dependsOn.every((key) => {
        const dependency = byKey.get(key);
        return !dependency || dependency.settled;
      }),
    );
}

/**
 * 从某一步重跑时，需要一起回到排队状态的所有步骤（含它自己）。
 *
 * 只重置这一步是不够的：下游拿的是它的旧产出，留着就变成「新上游 + 旧下游」
 * 的混合结果，而这种结果看起来完全正常，没人能发现它是错的。
 */
export function collectDownstream(
  nodes: Pick<DependencyNode, 'stepKey' | 'dependsOn'>[],
  rootKey: string,
): Set<string> {
  const affected = new Set<string>([rootKey]);

  // DAG 且步骤上限 50（StepsSchema），逐轮传播到不再增长即可，无需拓扑排序
  let grew = true;
  while (grew) {
    grew = false;
    for (const node of nodes) {
      if (affected.has(node.stepKey)) continue;
      if (node.dependsOn.some((key) => affected.has(key))) {
        affected.add(node.stepKey);
        grew = true;
      }
    }
  }

  return affected;
}
