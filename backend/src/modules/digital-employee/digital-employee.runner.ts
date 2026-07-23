import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generateText, tool, isStepCount } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { CapabilityService } from '../capability/capability.service';
import { AdapterInput } from '../capability/adapters/adapter.interface';

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

    // Build Vercel AI SDK tools from bound capabilities
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools: Record<string, any> = {};

    for (const binding of employee.bindings) {
      const cap = binding.capability;
      // Tool names must be snake_case and alphanumeric
      const toolName = cap.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();

      tools[toolName] = tool({
        description: cap.description,
        inputSchema: z.object(
          this.buildZodShape(cap.inputSchema as Record<string, unknown>),
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
      });
    }

    // Initialise sub2api provider
    const baseURL = this.configService.get<string>(
      'SUB2API_BASE_URL',
      'https://longdaoai.cn/v1',
    );
    const apiKey = this.configService.getOrThrow<string>('SUB2API_API_KEY');
    const defaultModel = this.configService.get<string>(
      'SUB2API_DEFAULT_MODEL',
      'gemini-3.5-flash-high',
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
   * Best-effort conversion from a JSON Schema properties definition
   * to a Zod shape accepted by AI SDK's inputSchema.
   */
  private buildZodShape(
    schema: Record<string, unknown>,
  ): Record<string, z.ZodTypeAny> {
    const properties = schema?.properties as Record<string, Record<string, unknown>> | undefined;
    const required = (schema?.required as string[]) ?? [];

    if (!properties || Object.keys(properties).length === 0) {
      // Fallback: single freeform input field
      return { input: z.string().describe('User input') };
    }

    const shape: Record<string, z.ZodTypeAny> = {};
    for (const [key, def] of Object.entries(properties)) {
      let zodType: z.ZodTypeAny;

      switch (def.type as string) {
        case 'number':
        case 'integer':
          zodType = z.number();
          break;
        case 'boolean':
          zodType = z.boolean();
          break;
        case 'array':
          zodType = z.array(z.any());
          break;
        case 'object':
          zodType = z.record(z.any());
          break;
        default:
          zodType = z.string();
      }

      if (typeof def.description === 'string') {
        zodType = zodType.describe(def.description);
      }

      shape[key] = required.includes(key) ? zodType : zodType.optional();
    }

    return shape;
  }
}
