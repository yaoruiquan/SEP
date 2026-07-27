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
    // Coze 的 SSE 把事件名放在 data 行之前的单独一行，需跨行记住当前事件，
    // 才能区分「增量片段」(message.delta) 与「完整消息」(message.completed)。
    let currentEvent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';  // Keep incomplete last line

      for (const line of lines) {
        // 真实格式为 `event:xxx`（冒号后无空格），兼容带空格的写法
        if (line.startsWith('event:')) {
          currentEvent = line.slice(6).trim();
          if (currentEvent === 'done') return output;
          continue;
        }

        const isCompletedMessage = currentEvent.endsWith('.completed');

        if (line.startsWith('data:')) {
          const raw = line.slice(5).trim();
          if (raw === '[DONE]') return output;

          try {
            const event = JSON.parse(raw);

            // 只处理助手发出的 answer 类型消息。
            // 关键：Coze 在 answer 完成后还会再发若干 type='verbose' 的消息
            // （knowledge_recall / generate_answer_finish），它们同样是
            // role='assistant' 且带 content。若不按 type 过滤，最后一条
            // verbose 的 JSON 会把真正的回复覆盖掉，用户看到的就是
            // {"msg_type":"generate_answer_finish",...} 这类内部数据。
            if (event.role !== 'assistant' || event.type !== 'answer') continue;

            // 增量片段用 content 字段承载（不是 delta），逐段累加；
            // 完整消息（message.completed）带全文，直接替换累加结果。
            if (typeof event.content !== 'string') continue;
            if (isCompletedMessage) {
              output = event.content;
            } else {
              output += event.content;
            }
          } catch {
            // Non-JSON lines (event: headers) — skip
          }
        }
      }
    }

    return output;
  }
}
