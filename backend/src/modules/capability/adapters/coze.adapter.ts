import { Injectable } from '@nestjs/common';
import { BaseAdapter } from './base.adapter';
import { AdapterInput, AdapterExecutionResult, AdapterConfig } from './adapter.interface';

const COZE_API_BASE = 'https://api.coze.cn';

@Injectable()
export class CozeAdapter extends BaseAdapter {
  constructor(private adapterConfig: AdapterConfig) {
    super('CozeAdapter');
  }

  async execute(input: AdapterInput): Promise<AdapterExecutionResult> {
    const start = Date.now();

    if (!this.adapterConfig.botId) {
      return { success: false, output: '', durationMs: 0, error: 'Coze botId not configured' };
    }

    // 兜底逻辑:优先用能力自带 PAT,为空则回退到全局 COZE_PAT 环境变量
    const pat = this.adapterConfig.apiKey || process.env.COZE_PAT;
    if (!pat) {
      return { success: false, output: '', durationMs: 0, error: 'Coze PAT not configured (neither agentConfig.apiKey nor COZE_PAT env)' };
    }

    try {
      const output = await this.streamToText(input, pat);
      return { success: true, output, durationMs: this.elapsed(start) };
    } catch (error: any) {
      this.logger.error(`Coze execution failed: ${error.message}`, error.stack);
      return { success: false, output: '', durationMs: this.elapsed(start), error: error.message };
    }
  }

  private async streamToText(input: AdapterInput, pat: string): Promise<string> {
    const resp = await fetch(`${COZE_API_BASE}/v3/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${pat}`,
      },
      body: JSON.stringify({
        bot_id: this.adapterConfig.botId,
        user_id: input.userId ?? input.sessionId,
        stream: true,
        additional_messages: [{ role: 'user', content: input.userMessage, content_type: 'text' }],
        conversation_id: input.sessionId,
      }),
    });

    if (!resp.ok || !resp.body) {
      throw new Error(`Coze API error ${resp.status}: ${await resp.text()}`);
    }

    return this.parseSseStream(resp.body);
  }

  private async parseSseStream(body: ReadableStream<Uint8Array>): Promise<string> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let output = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';  // Keep incomplete last line

      for (const line of lines) {
        if (line.startsWith('data:')) {
          const raw = line.slice(5).trim();
          if (raw === '[DONE]') return output;

          try {
            const event = JSON.parse(raw);
            // Accumulate assistant text deltas
            if (event.type === 'answer' && event.delta) {
              output += event.delta;
            }
            // conversation.message.delta from /v3/chat
            if (event.content && event.role === 'assistant') {
              output = event.content; // Completed message replaces accumulated delta
            }
          } catch {
            // Non-JSON lines (event: headers) — skip
          }
        }

        if (line.trim() === 'event: done' || line.includes('"event":"done"')) {
          return output;
        }
      }
    }

    return output;
  }
}
