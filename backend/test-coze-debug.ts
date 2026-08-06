const COZE_API_BASE = 'https://api.coze.cn';
const PAT = 'pat_yHvNIFjy7Kf4T3m2IUla3dwuxMIwvu4ncanuhG9qe1162Xhrnzzgk4rZWJS1HJG9';
const BOT_ID = '7665566040915066880';

async function test() {
  console.log('Calling Coze API...');
  const resp = await fetch(`${COZE_API_BASE}/v3/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${PAT}`,
    },
    body: JSON.stringify({
      bot_id: BOT_ID,
      user_id: 'test-user',
      stream: true,
      additional_messages: [{ role: 'user', content: '你好', content_type: 'text' }],
    }),
  });

  console.log('Status:', resp.status);
  console.log('Headers:', Object.fromEntries(resp.headers.entries()));

  if (!resp.ok) {
    console.log('Error body:', await resp.text());
    return;
  }

  if (!resp.body) {
    console.log('No response body');
    return;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let lineCount = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      lineCount++;
      console.log(`[Line ${lineCount}]:`, line);
      
      if (line.startsWith('data:')) {
        const raw = line.slice(5).trim();
        if (raw !== '[DONE]') {
          try {
            const event = JSON.parse(raw);
            console.log(`  → Parsed:`, JSON.stringify(event, null, 2));
          } catch (e) {
            console.log(`  → Not JSON`);
          }
        }
      }
    }
  }
  
  console.log('\nTotal lines:', lineCount);
}

test().catch(console.error);
