import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  generateText,
  isStepCount,
  jsonSchema,
  type JSONSchema7,
  type ToolSet,
} from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { PrismaService } from '../../prisma/prisma.service';
import { CapabilityService } from '../capability/capability.service';
import { AdapterInput } from '../capability/adapters/adapter.interface';
import { DEFAULT_MODEL_ID } from 'shared';

@Injectable()
export class DigitalEmployeeRunner {
  private readonly logger = new Logger(DigitalEmployeeRunner.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly capabilityService: CapabilityService,
    private readonly configService: ConfigService,
  ) {}

  async run(
    employeeId: string,
    userMessage: string,
    sessionId: string,
    userId?: string,
  ) {
    const employee = await this.prisma.digitalEmployee.findUnique({
      where: { id: employeeId },
      include: {
        bindings: {
          include: {
            capability: {
              select: {
                id: true,
                name: true,
                description: true,
                inputSchema: true,
                type: true,
              },
            },
          },
          orderBy: { order: 'asc' },
        },
      },
    });

    if (!employee) {
      throw new NotFoundException(`Digital employee ${employeeId} not found`);
    }

    // Build Vercel AI SDK tools from bound capabilities.
    // 明确声明为 ToolSet 避免 TS 对 generateText 泛型做无限推断（OOM 来源）。
    const tools: ToolSet = {};

    for (const binding of employee.bindings) {
      const cap = binding.capability;
      // Tool names must be snake_case and alphanumeric
      const toolName = cap.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();

      // inputSchema 在 DB 里本来就是 JSON Schema，不需要转 Zod。
      // jsonSchema() 是 AI SDK 为运行时 schema 设计的零推断路径，
      // 不会触发 TS 对 generateText TOOLS 泛型的递归展开（之前的 OOM 来源）。
      tools[toolName] = {
        description: cap.description,
        inputSchema: jsonSchema(
          this.toJsonSchema(cap.inputSchema as Record<string, unknown>),
        ),
        execute: async (params: Record<string, unknown>) => {
          this.logger.log(`Tool call: ${cap.name} [${cap.id}]`);
          const input: AdapterInput = {
            userMessage: JSON.stringify(params),
            sessionId,
            userId,
          };
          const result = await this.capabilityService.execute(cap.id, input);
          return result.success ? result.output : `Error: ${result.error}`;
        },
      };
    }

    // Initialise sub2api provider
    const baseURL = this.configService.get<string>(
      'SUB2API_BASE_URL',
      'https://longdaoai.cn/v1',
    );
    const apiKey = this.configService.getOrThrow<string>('SUB2API_API_KEY');
    const defaultModel = this.configService.get<string>(
      'SUB2API_DEFAULT_MODEL',
      DEFAULT_MODEL_ID,
    );

    const provider = createOpenAICompatible({
      name: 'sub2api',
      baseURL,
      apiKey,
    });

    const modelId = employee.modelId || defaultModel;
    this.logger.log(`Running "${employee.name}" — model: ${modelId}, tools: ${Object.keys(tools).length}`);

    const { text, steps } = await generateText({
      model: provider(modelId),
      system: employee.systemPrompt,
      prompt: userMessage,
      tools: Object.keys(tools).length > 0 ? tools : undefined,
      stopWhen: isStepCount(employee.maxSteps),
    });

    return {
      text,
      stepsCount: steps.length,
      employeeId: employee.id,
      employeeName: employee.name,
    };
  }

  /**
   * 把 Capability.inputSchema 规范成模型可用的 JSON Schema。
   *
   * 库里存的已经是 JSON Schema，这里只做两件事：
   * ① 补齐 type/properties 等顶层字段（历史数据可能只有 properties）；
   * ② properties 为空时给一个 freeform input 兜底 —— 工具必须有至少一个
   *    参数，否则部分模型会拒绝调用。
   */
  private toJsonSchema(schema: Record<string, unknown>): JSONSchema7 {
    const properties = schema?.properties as
      | Record<string, JSONSchema7>
      | undefined;

    if (!properties || Object.keys(properties).length === 0) {
      return {
        type: 'object',
        properties: {
          input: { type: 'string', description: 'User input' },
        },
        required: ['input'],
      };
    }

    return {
      type: 'object',
      properties,
      required: (schema?.required as string[]) ?? [],
    };
  }
}
