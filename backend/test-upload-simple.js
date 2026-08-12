const fs = require('fs');
const path = require('path');

async function main() {
  const BASE_URL = 'http://localhost:3001';
  
  // Login
  const loginRes = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'boss@acme.local',
      password: 'Demo123456',
    }),
  });
  
  const { token, enterprise } = await loginRes.json();
  console.log('Logged in, token:', token.substring(0, 20) + '...');
  
  // Create KB
  const kbRes = await fetch(`${BASE_URL}/knowledge-bases`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      name: `Test-${Date.now()}`,
      description: 'Test upload',
    }),
  });
  
  const kb = await kbRes.json();
  console.log('Created KB:', kb.id);
  
  // Create a real file
  const testFile = path.join(__dirname, 'test-upload.txt');
  fs.writeFileSync(testFile, '这是一个测试文档\n\n包含一些中文内容用于测试检索功能。');
  
  // Upload using native fetch FormData
  const formData = new FormData();
  const fileBlob = new Blob([fs.readFileSync(testFile)], { type: 'text/plain' });
  formData.append('file', fileBlob, 'test-upload.txt');
  
  const uploadRes = await fetch(`${BASE_URL}/knowledge-bases/${kb.id}/documents`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
    body: formData,
  });
  
  console.log('Upload status:', uploadRes.status);
  const result = await uploadRes.text();
  console.log('Upload result:', result);
  
  // Cleanup
  fs.unlinkSync(testFile);
}

main().catch(console.error);
