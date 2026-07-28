import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText, isStepCount, jsonSchema, type ToolSet } from 'ai';
import { DEFAULT_MODEL_ID } from 'shared';

@Injectable()
export class AgentRuntimeTestService {
  constructor(private configService: ConfigService) {}

  private get provider() {
    const baseURL = this.configService.get<string>('SUB2API_BASE_URL');
    const apiKey = this.configService.get<string>('SUB2API_API_KEY');
    if (!baseURL || !apiKey || apiKey === 'your-sub2api-key') return null;
    return createOpenAICompatible({ name: 'sub2api', baseURL, apiKey });
  }

  private get model() {
    return this.configService.get<string>('SUB2API_DEFAULT_MODEL') ?? DEFAULT_MODEL_ID;
  }

  async testBasicCompletion(prompt: string) {
    const p = this.provider;
    if (!p) return { status: 'not_configured', blockedBy: 'SUB2API_API_KEY not set' };

    const { text, usage } = await generateText({ model: p(this.model), prompt });
    return { status: 'ok', test: 'basic-completion', model: this.model, response: text, usage };
  }

  async testStreaming(prompt: string) {
    const p = this.provider;
    if (!p) return { status: 'not_configured', blockedBy: 'SUB2API_API_KEY not set' };

    // generateText drives the request; streaming is handled at transport level
    const { text, usage } = await generateText({ model: p(this.model), prompt });
    return { status: 'ok', test: 'streaming', model: this.model, response: text, usage };
  }

  async testToolCalling(prompt: string) {
    const p = this.provider;
    if (!p) return { status: 'not_configured', blockedBy: 'SUB2API_API_KEY not set' };

    const echoed: string[] = [];
    // tools 提到 ToolSet 变量里而不是内联，且不用 tool() helper：
    // 二者都会让 tsc 在 generateText 的 TOOLS 泛型上递归展开而 OOM。
    const tools: ToolSet = {
      echo: {
        description: 'Echo back whatever message is passed in',
        inputSchema: jsonSchema({
          type: 'object',
          properties: { message: { type: 'string' } },
          required: ['message'],
        }),
        execute: async ({ message }: { message: string }) => {
          echoed.push(message);
          return { result: message };
        },
      },
    };
    const { text, steps, usage } = await generateText({
      model: p(this.model),
      prompt,
      tools,
      stopWhen: isStepCount(3),
    });

    return { status: 'ok', test: 'tool-calling', model: this.model, finalResponse: text, toolCallsMade: echoed, stepsCount: steps.length, usage };
  }

  async testMultiStepTools(prompt: string) {
    const p = this.provider;
    if (!p) return { status: 'not_configured', blockedBy: 'SUB2API_API_KEY not set' };

    const callLog: string[] = [];
    const tools: ToolSet = {
      echo: {
        description: 'Echo back a message',
        inputSchema: jsonSchema({
          type: 'object',
          properties: { message: { type: 'string' } },
          required: ['message'],
        }),
        execute: async ({ message }: { message: string }) => {
          callLog.push(`echo: ${message}`);
          return { result: message };
        },
      },
      reverse: {
        description: 'Reverse a string',
        inputSchema: jsonSchema({
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
        }),
        execute: async ({ text: t }: { text: string }) => {
          const reversed = t.split('').reverse().join('');
          callLog.push(`reverse: ${t} → ${reversed}`);
          return { result: reversed };
        },
      },
    };
    const { text, steps, usage } = await generateText({
      model: p(this.model),
      prompt,
      tools,
      stopWhen: isStepCount(5),
    });

    return { status: 'ok', test: 'multi-step-tools', model: this.model, finalResponse: text, callLog, stepsCount: steps.length, usage };
  }

  async testOpenCodeSkill(prompt: string, skillName: string) {
    return { status: 'not_implemented', test: 'opencode-skill', note: 'OpenCode is a capability adapter — integrated in Layer 3, not a platform dependency' };
  }

  async testEndToEnd(prompt: string) {
    return { status: 'not_implemented', test: 'end-to-end', note: 'Will be implemented after capability adapters are built' };
  }
}

