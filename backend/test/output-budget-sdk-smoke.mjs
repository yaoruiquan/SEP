import assert from 'node:assert/strict';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText, streamText } from 'ai';

// Exercise the installed ESM SDKs; Jest maps these modules to CJS stubs.
const requests = [];
const provider = createOpenAICompatible({
  name: 'sub2api', baseURL: 'https://relay.test/v1', apiKey: 'test-placeholder',
  fetch: async (_url, init) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    if (body.stream) {
      const chunk = { id: 'test', model: 'test-model', object: 'chat.completion.chunk', created: 1,
        choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: 'stop' }] };
      return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }
    return Response.json({ id: 'test', object: 'chat.completion', created: 1, model: 'test-model',
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
  },
});

for (const maxOutputTokens of [undefined, 65536]) {
  const options = { model: provider('test-model'), prompt: 'test',
    ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }) };
  assert.equal((await generateText(options)).text, 'ok');
  assert.equal(await streamText(options).text, 'ok');
  for (const request of requests.splice(0)) {
    assert.equal(request.max_tokens, maxOutputTokens);
    assert.equal(Object.hasOwn(request, 'max_tokens'), maxOutputTokens !== undefined);
    assert.equal(Object.hasOwn(request, 'max_completion_tokens'), false);
  }
}
console.log('output budget SDK smoke passed: streaming and non-streaming omission and explicit 65536');
