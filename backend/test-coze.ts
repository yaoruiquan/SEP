import { CozeAdapter } from './src/modules/capability/adapters/coze.adapter';

const adapter = new CozeAdapter({
  botId: '7665566040915066880',
  apiKey: 'pat_yHvNIFjy7Kf4T3m2IUla3dwuxMIwvu4ncanuhG9qe1162Xhrnzzgk4rZWJS1HJG9',
  platform: 'COZE'
});

async function test() {
  console.log('Testing Coze adapter...');
  const result = await adapter.execute({
    userId: 'test-user',
    sessionId: 'test-session',
    userMessage: '你好',
    parameters: {}
  });
  
  console.log('Result:', JSON.stringify(result, null, 2));
}

test().catch(console.error);
