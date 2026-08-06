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
  
  const text = await resp.text();
  console.log('Response body:', text);
  
  try {
    const json = JSON.parse(text);
    console.log('Parsed JSON:', JSON.stringify(json, null, 2));
  } catch (e) {
    console.log('Not valid JSON');
  }
}

test().catch(console.error);
