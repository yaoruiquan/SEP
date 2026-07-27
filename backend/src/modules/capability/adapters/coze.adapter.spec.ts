/**
 * Coze SSE 解析回归测试。
 *
 * 用真实 /v3/chat 流式响应的事件序列（2026-07-27 实测抓取）构造最小复现：
 * Coze 在 answer 完成之后**还会再发 type='verbose' 的消息**
 * （knowledge_recall / generate_answer_finish），它们同样是 role='assistant'
 * 且带 content。修复前的实现对所有 role='assistant' 做覆盖式赋值
 * （output = event.content），导致最后那条 verbose 的 JSON 把真正的回复冲掉，
 * 用户看到的是 {"msg_type":"generate_answer_finish",...} 这类内部数据。
 *
 * 另两处同批修复：
 * - 增量片段的文本在 `content` 字段（不是 `delta`），旧代码判 event.delta 属死代码
 * - 结束事件真实格式是 `event:done`（冒号后无空格），旧代码判 `event: done` 匹配不上
 */
import { CozeAdapter } from './coze.adapter';
import type { AdapterConfig } from './adapter.interface';

/** 把 SSE 文本包装成 adapter 期望的 ReadableStream */
function sseStream(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

/** 访问私有方法做单元测试 */
function parse(adapter: CozeAdapter, sse: string): Promise<string> {
  return (adapter as unknown as {
    parseSseStream(b: ReadableStream<Uint8Array>): Promise<string>;
  }).parseSseStream(sseStream(sse));
}

const CONFIG: AdapterConfig = { platform: 'COZE', botId: 'bot-1', apiKey: 'pat-x' };

describe('CozeAdapter.parseSseStream', () => {
  let adapter: CozeAdapter;
  beforeEach(() => {
    adapter = new CozeAdapter(CONFIG);
  });

  it('累加 delta 片段并以 completed 全文为准', async () => {
    const sse = [
      'event:conversation.message.delta',
      'data:{"role":"assistant","type":"answer","content":"未"}',
      'event:conversation.message.delta',
      'data:{"role":"assistant","type":"answer","content":"找到"}',
      'event:conversation.message.completed',
      'data:{"role":"assistant","type":"answer","content":"未找到相关知识"}',
      'event:done',
      'data:"[DONE]"',
      '',
    ].join('\n');

    expect(await parse(adapter, sse)).toBe('未找到相关知识');
  });

  it('回归：answer 之后的 verbose 消息不得覆盖回复', async () => {
    const sse = [
      // 前置 verbose（知识库召回），修复前会被当成回复
      'event:conversation.message.completed',
      'data:{"role":"assistant","type":"verbose","content":"{\\"msg_type\\":\\"knowledge_recall\\"}"}',
      'event:conversation.message.delta',
      'data:{"role":"assistant","type":"answer","content":"未找到相关知识"}',
      'event:conversation.message.completed',
      'data:{"role":"assistant","type":"answer","content":"未找到相关知识"}',
      // 关键：answer 之后还有一条 verbose —— 这正是线上返回 JSON 垃圾的元凶
      'event:conversation.message.completed',
      'data:{"role":"assistant","type":"verbose","content":"{\\"msg_type\\":\\"generate_answer_finish\\"}"}',
      'event:conversation.chat.completed',
      'data:{"status":"completed","usage":{"token_count":426}}',
      'event:done',
      'data:"[DONE]"',
      '',
    ].join('\n');

    const out = await parse(adapter, sse);
    expect(out).toBe('未找到相关知识');
    expect(out).not.toContain('generate_answer_finish');
    expect(out).not.toContain('knowledge_recall');
  });

  it('event:done（冒号后无空格）能正确终止', async () => {
    const sse = [
      'event:conversation.message.completed',
      'data:{"role":"assistant","type":"answer","content":"答案"}',
      'event:done',
      'data:"[DONE]"',
      // done 之后的内容必须被忽略
      'event:conversation.message.completed',
      'data:{"role":"assistant","type":"answer","content":"不该出现"}',
      '',
    ].join('\n');

    expect(await parse(adapter, sse)).toBe('答案');
  });

  it('忽略 role=user 与非字符串 content', async () => {
    const sse = [
      'event:conversation.message.delta',
      'data:{"role":"user","type":"answer","content":"用户输入"}',
      'event:conversation.message.delta',
      'data:{"role":"assistant","type":"answer","content":null}',
      'event:conversation.message.completed',
      'data:{"role":"assistant","type":"answer","content":"只要这句"}',
      'event:done',
      'data:"[DONE]"',
      '',
    ].join('\n');

    expect(await parse(adapter, sse)).toBe('只要这句');
  });

  it('非 JSON 的 data 行不致崩溃', async () => {
    const sse = [
      'event:conversation.message.delta',
      'data:这不是JSON',
      'event:conversation.message.completed',
      'data:{"role":"assistant","type":"answer","content":"正常"}',
      'event:done',
      'data:"[DONE]"',
      '',
    ].join('\n');

    expect(await parse(adapter, sse)).toBe('正常');
  });
});
