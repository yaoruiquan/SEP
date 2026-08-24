import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { DEFAULT_MODEL_ID } from 'shared';
import {
  PlannerOutputSchema,
  type PlannerOutput,
  type TaskPlanPreviewDto,
} from './task-planning.types';

type CandidateCapability = { id: string; name: string; description: string; type: string };
type CandidateEmployee = {
  id: string;
  name: string;
  description: string;
  position: string;
  industry: string;
  avatar: string | null;
  capabilities: CandidateCapability[];
};

@Injectable()
export class TaskPlanningService {
  private readonly logger = new Logger(TaskPlanningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: SubscriptionService,
    private readonly config: ConfigService,
  ) {}

  async preview(userId: string, dto: TaskPlanPreviewDto) {
    const subscriptions = (await this.subscriptions.findAll(userId))
      .filter((subscription) => subscription.status === 'ACTIVE')
      .filter((subscription) => !dto.employeeIds || dto.employeeIds.includes(subscription.employee.id));

    if (subscriptions.length === 0) {
      throw new BadRequestException('当前没有可用于编排的已订阅硅基员工');
    }

    const employeeIds = subscriptions.map((subscription) => subscription.employee.id);
    const employees = await this.prisma.digitalEmployee.findMany({
      where: { id: { in: employeeIds }, status: 'APPROVED' },
      select: {
        id: true,
        name: true,
        description: true,
        position: true,
        industry: true,
        avatar: true,
        bindings: {
          orderBy: { priority: 'asc' },
          select: {
            capability: {
              select: { id: true, name: true, description: true, type: true },
            },
          },
        },
      },
    }) as unknown as Array<{
      id: string;
      name: string;
      description: string;
      position: string;
      industry: string;
      avatar: string | null;
      bindings: Array<{ capability: CandidateCapability }>;
    }>;

    const candidates: CandidateEmployee[] = employees.map((employee) => ({
      id: employee.id,
      name: employee.name,
      description: employee.description,
      position: employee.position,
      industry: employee.industry,
      avatar: employee.avatar,
      capabilities: employee.bindings.map(({ capability }) => capability),
    })).filter((employee) => employee.capabilities.length > 0);

    if (candidates.length === 0) {
      throw new BadRequestException('已订阅员工都没有绑定可执行能力');
    }

    const plannerOutput: PlannerOutput = await this.generatePlan(dto.objective, candidates);
    const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    const stepIds = plannerOutput.steps.map((_, index) => `step-${index + 1}`);
    const steps = plannerOutput.steps.flatMap((step, index) => {
      const employee = candidateById.get(step.employeeId);
      const capability = employee?.capabilities.find((item) => item.id === step.capabilityId);
      if (!employee || !capability) return [];

      const dependsOn = step.dependsOnStepNumbers
        .filter((number) => number <= index && number > 0)
        .map((number) => stepIds[number - 1]);

      return [{
        id: stepIds[index],
        order: index + 1,
        title: step.title,
        description: step.description,
        intent: 'llm_planned',
        employee,
        capability,
        dependsOn,
        rationale: step.rationale,
        estimatedSeconds: step.estimatedSeconds,
        status: 'queued' as const,
        progress: 0,
      }];
    });

    if (steps.length === 0) {
      throw new BadGatewayException('规划模型返回了无效的员工或能力选择，请重试');
    }

    return {
      id: `plan-${crypto.randomUUID()}`,
      objective: dto.objective.trim(),
      summary: plannerOutput.summary,
      steps,
      status: 'awaiting_confirmation' as const,
      createdAt: new Date().toISOString(),
      planner: {
        type: 'llm',
        model: this.config.get<string>('SUB2API_PLANNER_MODEL', this.config.get<string>('SUB2API_DEFAULT_MODEL', DEFAULT_MODEL_ID)),
      },
    };
  }

  private async generatePlan(objective: string, candidates: CandidateEmployee[]): Promise<PlannerOutput> {
    const baseURL = this.config.get<string>('SUB2API_BASE_URL', 'https://longdaoai.cn/v1');
    const apiKey = this.config.get<string>('SUB2API_API_KEY');
    if (!apiKey) throw new BadGatewayException('任务规划模型未配置，请联系管理员');

    const modelId = this.config.get<string>(
      'SUB2API_PLANNER_MODEL',
      this.config.get<string>('SUB2API_DEFAULT_MODEL', DEFAULT_MODEL_ID),
    );
    const catalog = JSON.stringify(candidates, null, 2);

    try {
      const response = await fetch(`${baseURL.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: modelId,
          messages: [
            {
              role: 'system',
              content: [
          '你是硅基人才平台的任务编排规划器。',
          '你的工作是把用户目标拆解为可执行、有依赖关系的步骤，并从候选硅基员工及其能力中选择最合适的执行者。',
          '只能使用候选目录中出现的 employeeId 和 capabilityId，禁止臆造 ID。',
          '只有确实需要多个角色时才拆成多个步骤；简单任务可以只有一个步骤。',
          'dependsOnStepNumbers 只能填写前面已经出现的步骤编号。',
          'estimatedSeconds 必须是 10 到 3600 之间的整数。',
          '不要执行任何任务，只生成等待用户确认的计划。',
          '只返回一个合法 JSON 对象，不要使用 Markdown 代码块或附加说明。',
          'JSON 必须符合：{ "summary": string, "steps": [{ "employeeId": string, "capabilityId": string, "title": string, "description": string, "rationale": string, "dependsOnStepNumbers": number[], "estimatedSeconds": number }] }。',
              ].join('\n'),
            },
            { role: 'user', content: `用户任务目标：\n${objective}\n\n候选硅基员工与能力目录：\n${catalog}` },
          ],
          temperature: 0.1,
          max_tokens: 4000,
        }),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`relay ${response.status}: ${detail.slice(0, 240)}`);
      }
      const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      const text = payload.choices?.[0]?.message?.content;
      if (!text) throw new Error('规划模型返回了空内容');

      return PlannerOutputSchema.parse(this.extractPlanJson(text));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Task planning failed: ${message}`);
      if (error instanceof Error && error.stack) this.logger.debug(error.stack);
      throw new BadGatewayException('任务规划模型暂时不可用，请稍后重试');
    }
  }

  private extractPlanJson(text: string): unknown {
    const fencedJson = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    const source = (fencedJson?.[1] ?? text).trim();
    const firstBrace = source.indexOf('{');
    const lastBrace = source.lastIndexOf('}');

    if (firstBrace < 0 || lastBrace <= firstBrace) {
      throw new BadGatewayException('规划模型没有返回可解析的 JSON 计划');
    }

    return JSON.parse(source.slice(firstBrace, lastBrace + 1));
  }
}
