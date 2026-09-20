import { ChatCompletionRequestSchema } from './index';

const toolCall = {
  id: 'call_test_ls_001',
  type: 'function',
  function: { name: 'ls', arguments: '{}' },
};

function followUp(content: string | null = '') {
  return {
    model: 'deepseek-v4.1-flash',
    messages: [
      { role: 'user', content: '查看工作目录中有什么文件' },
      { role: 'assistant', content, tool_calls: [structuredClone(toolCall)], reasoning_content: 'List the directory.' },
      { role: 'tool', tool_call_id: toolCall.id, content: 'file-a.txt\nfile-b.txt' },
    ],
    tools: [{ type: 'function', function: { name: 'ls', parameters: { type: 'object' } } }],
    tool_choice: 'auto',
    parallel_tool_calls: false,
    stream: true,
    stream_options: { include_usage: true },
    thinking: { type: 'enabled' },
    reasoning_effort: 'high',
  };
}

describe('ChatCompletionRequestSchema tool round trip', () => {
  it('preserves tool linkage, reasoning and request options after validation', () => {
    const request = followUp();
    expect(ChatCompletionRequestSchema.parse(request)).toEqual(request);
  });

  it.each(['', null, undefined])('accepts assistant tool calls with content=%s', (content) => {
    const request = followUp();
    request.messages[1].content = content;
    expect(ChatCompletionRequestSchema.parse(request).messages[1]).toEqual(request.messages[1]);
  });

  it('preserves an explicitly empty reasoning_content', () => {
    const request = followUp();
    request.messages[1].reasoning_content = '';
    expect(ChatCompletionRequestSchema.parse(request).messages[1]).toHaveProperty('reasoning_content', '');
  });

  it('preserves multiple tool results without requiring every result to immediately follow assistant', () => {
    const request = followUp();
    request.messages[1].tool_calls.push({ ...structuredClone(toolCall), id: 'call_second' });
    request.messages.push({ role: 'tool', tool_call_id: 'call_second', content: 'second result' });
    expect(ChatCompletionRequestSchema.parse(request)).toEqual(request);
  });

  it('accepts empty tool_calls on an assistant text response', () => {
    const request = { model: 'test', messages: [{ role: 'assistant', content: 'done', tool_calls: [] }] };
    expect(ChatCompletionRequestSchema.parse(request)).toEqual(request);
  });

  it('still strips unrelated caller-supplied fields', () => {
    const parsed = ChatCompletionRequestSchema.parse({ ...followUp(), enterpriseId: 'untrusted' });
    expect(parsed).not.toHaveProperty('enterpriseId');
  });

  it('requires tool_call_id for tool results', () => {
    const request = followUp();
    delete request.messages[2].tool_call_id;
    const result = ChatCompletionRequestSchema.safeParse(request);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: ['messages', 2, 'tool_call_id'] }),
      ]));
    }
  });

  it('requires content for non-tool-call assistant and user messages', () => {
    for (const role of ['user', 'assistant', 'tool']) {
      expect(ChatCompletionRequestSchema.safeParse({
        model: 'test', messages: [{ role, content: null, tool_call_id: 'call_1' }],
      }).success).toBe(false);
    }
  });

  it('validates function arguments as the original JSON string, not an object', () => {
    const request = followUp();
    (request.messages[1].tool_calls[0].function.arguments as unknown) = {};
    expect(ChatCompletionRequestSchema.safeParse(request).success).toBe(false);
  });
});
