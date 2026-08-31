import type { TaskHandoffEntry } from 'shared';

/** 交接摘要的截断长度。全文始终留在上游步骤的 output 里，这里只是给人看的引子。 */
export const HANDOFF_EXCERPT_CHARS = 400;

export interface UpstreamOutput {
  stepKey: string;
  stepTitle: string;
  employeeName: string;
  output: string | null;
}

export interface StepPromptInput {
  objective: string;
  stepTitle: string;
  stepDescription: string;
  /** 按 dependsOn 顺序排列的上游步骤 */
  upstream: UpstreamOutput[];
}

export interface StepPromptResult {
  prompt: string;
  handoff: TaskHandoffEntry[];
}

function excerpt(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= HANDOFF_EXCERPT_CHARS) return trimmed;
  return `${trimmed.slice(0, HANDOFF_EXCERPT_CHARS)}…`;
}

/**
 * 拼装单步 prompt，同时产出结构化的交接记录。
 *
 * 这段逻辑原先在前端（tasks/page.tsx 的 executePlan 内），拼完即丢，
 * 所以会议要求的「每一步的输入」根本无处可查。搬到服务端后 prompt 全文落
 * TaskRunStep.inputPrompt，交接落 handoff。
 *
 * 与前端旧版的唯一实质差别：上游产出现在带「谁交的」标题。旧版把多份产出用
 * `---` 裸拼在一起，模型分不清哪段来自谁，人在 UI 里也分不清 —— 而「员工接力」
 * 恰恰是这个产品要展示的东西。
 */
export function buildStepPrompt(input: StepPromptInput): StepPromptResult {
  const handoff: TaskHandoffEntry[] = input.upstream
    .filter((item): item is UpstreamOutput & { output: string } => Boolean(item.output?.trim()))
    .map((item) => ({
      fromStepKey: item.stepKey,
      fromStepTitle: item.stepTitle,
      fromEmployeeName: item.employeeName,
      excerpt: excerpt(item.output),
      chars: item.output.trim().length,
    }));

  const handoffBlock =
    handoff.length > 0
      ? [
          '上游同事已经交付的内容：',
          ...input.upstream
            .filter((item) => Boolean(item.output?.trim()))
            .map(
              (item) =>
                `【${item.employeeName} · ${item.stepTitle}】\n${(item.output as string).trim()}`,
            ),
        ].join('\n\n')
      : '';

  const prompt = [
    `这是一个经过用户确认的多步骤任务。总目标：${input.objective}`,
    `当前步骤：${input.stepTitle}\n${input.stepDescription}`,
    handoffBlock,
    '请只完成当前步骤，并返回可供后续步骤直接使用的清晰结果。',
  ]
    .filter(Boolean)
    .join('\n\n');

  return { prompt, handoff };
}
