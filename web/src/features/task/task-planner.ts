import type {
  TaskCandidateCapability,
  TaskCandidateEmployee,
  TaskPlan,
  TaskPlanStep,
} from './task-orchestration';

interface IntentTemplate {
  key: string;
  title: string;
  description: string;
  terms: string[];
  estimate: number;
}

const INTENTS: IntentTemplate[] = [
  {
    key: 'research',
    title: '收集资料与事实',
    description: '先收集任务所需的资料、数据或外部事实，形成可供后续步骤使用的输入。',
    terms: ['调研', '研究', '竞品', '市场', '资料', '收集', '搜索', '信息', 'research', 'market'],
    estimate: 90,
  },
  {
    key: 'analysis',
    title: '分析数据与问题',
    description: '对输入资料进行整理、对比和分析，识别趋势、异常与关键结论。',
    terms: ['分析', '数据', '销售', '指标', '趋势', '异常', '统计', '洞察', 'analysis', 'data'],
    estimate: 120,
  },
  {
    key: 'content',
    title: '生成内容或方案',
    description: '将分析结果整理成面向目标读者的内容、方案或执行建议。',
    terms: ['写', '创作', '文案', '内容', '营销', '方案', '策划', '生成', 'content', 'copy'],
    estimate: 100,
  },
  {
    key: 'report',
    title: '整理最终交付物',
    description: '汇总前序步骤的结果，输出结构清晰、可直接使用的报告或简报。',
    terms: ['报告', '报表', '简报', '总结', '汇报', '交付', '文档', 'report', 'brief'],
    estimate: 90,
  },
  {
    key: 'technical',
    title: '完成技术实现',
    description: '将目标转化为代码、接口或可验证的技术变更，并给出实现结果。',
    terms: ['代码', '开发', '前端', '后端', '接口', '程序', '修复', '实现', 'code', 'api'],
    estimate: 180,
  },
];

const FALLBACK_INTENT: IntentTemplate = {
  key: 'general',
  title: '执行任务目标',
  description: '根据任务目标调用最匹配的硅基员工完成工作，并返回可复用的结果。',
  terms: [],
  estimate: 120,
};

function tokenize(value: string): string[] {
  return value
    .toLocaleLowerCase()
    .match(/[\u4e00-\u9fff]{2,}|[a-z][a-z0-9_-]{2,}/g) ?? [];
}

function textOf(candidate: TaskCandidateEmployee | TaskCandidateCapability): string {
  if ('capabilities' in candidate) {
    return [candidate.name, candidate.position, candidate.industry, candidate.description]
      .join(' ')
      .toLocaleLowerCase();
  }
  return [candidate.name, candidate.description].join(' ').toLocaleLowerCase();
}

function score(text: string, terms: string[], objectiveTokens: string[]): number {
  const normalized = text.toLocaleLowerCase();
  return terms.reduce((total, term) => total + (normalized.includes(term.toLocaleLowerCase()) ? 3 : 0), 0)
    + objectiveTokens.reduce((total, token) => total + (normalized.includes(token) ? 1 : 0), 0);
}

function chooseCandidate(
  objective: string,
  intent: IntentTemplate,
  candidates: TaskCandidateEmployee[],
  used: Set<string>,
): { employee: TaskCandidateEmployee; capability: TaskCandidateCapability; score: number } | null {
  const objectiveTokens = tokenize(objective);
  const ranked = candidates
    .flatMap((employee) => employee.capabilities.map((capability) => ({
      employee,
      capability,
      score: score(textOf(employee), intent.terms, objectiveTokens)
        + score(textOf(capability), intent.terms, objectiveTokens)
        + (used.has(employee.id) ? -1 : 0),
    })))
    .sort((a, b) => b.score - a.score);

  return ranked[0] ?? null;
}

function inferIntents(objective: string): IntentTemplate[] {
  const normalized = objective.toLocaleLowerCase();
  const matches = INTENTS.filter((intent) => intent.terms.some((term) => normalized.includes(term)));

  // A report usually follows analysis. Keep the sequence understandable even when
  // the user only writes “分析并输出报告” and does not mention data explicitly.
  if (matches.some((intent) => intent.key === 'report') && !matches.some((intent) => intent.key === 'analysis')) {
    matches.unshift(INTENTS.find((intent) => intent.key === 'analysis')!);
  }

  const unique = matches.filter((intent, index) => matches.findIndex((item) => item.key === intent.key) === index);
  return unique.length > 0 ? unique.slice(0, 4) : [FALLBACK_INTENT];
}

export function buildTaskPlan(objective: string, candidates: TaskCandidateEmployee[]): TaskPlan {
  const cleanObjective = objective.trim();
  const intents = inferIntents(cleanObjective);
  const usedEmployees = new Set<string>();
  const steps: TaskPlanStep[] = [];

  intents.forEach((intent, index) => {
    const selection = chooseCandidate(cleanObjective, intent, candidates, usedEmployees);
    if (!selection) return;

    usedEmployees.add(selection.employee.id);
    const dependsOn = intent.key === 'report' || intent.key === 'content'
      ? steps.map((step) => step.id)
      : [];
    const stepId = `step-${index + 1}`;
    steps.push({
      id: stepId,
      order: index + 1,
      title: intent.title,
      description: intent.description,
      intent: intent.key,
      employee: selection.employee,
      capability: selection.capability,
      dependsOn,
      rationale: selection.score > 0
        ? `根据“${intent.title}”与员工岗位、能力描述的匹配度选择`
        : '当前订阅员工中没有更明确的匹配，使用可用能力作为兜底',
      estimatedSeconds: intent.estimate,
      status: 'queued',
      progress: 0,
    });
  });

  const fallbackCandidate = candidates.find((candidate) => candidate.capabilities.length > 0);
  if (steps.length === 0 && fallbackCandidate) {
    const capability = fallbackCandidate.capabilities[0];
    steps.push({
      id: 'step-1',
      order: 1,
      title: FALLBACK_INTENT.title,
      description: FALLBACK_INTENT.description,
      intent: FALLBACK_INTENT.key,
      employee: fallbackCandidate,
      capability,
      dependsOn: [],
      rationale: '使用第一个可用员工和能力作为执行兜底',
      estimatedSeconds: FALLBACK_INTENT.estimate,
      status: 'queued',
      progress: 0,
    });
  }

  const summary = steps.length > 0
    ? `已分析任务，计划调用 ${new Set(steps.map((step) => step.employee.id)).size} 位硅基员工，执行 ${steps.length} 个步骤`
    : '暂无可用的硅基员工，请先订阅至少一位员工并为其绑定能力';

  return {
    id: `plan-${Date.now()}`,
    objective: cleanObjective,
    summary,
    steps,
    status: 'awaiting_confirmation',
    createdAt: new Date().toISOString(),
  };
}
