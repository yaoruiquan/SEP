import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanSkillDirectory } from './scanner.mjs';
import { createStoredZip } from './zip.mjs';
import { createContribution, packageSelectedSkill, uploadSkillPackage } from './upload.mjs';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'sep-skill-upload-'));
  const skill = join(root, 'weekly-report');
  await mkdir(join(skill, 'examples'), { recursive: true });
  await writeFile(join(skill, 'SKILL.md'), '---\nname: 周报 Skill\ndescription: 自动汇总周报并输出可执行结论\n---\n# 角色\n你是周报助手');
  await writeFile(join(skill, 'examples', 'sample.txt'), 'sample');
  return { root, skill };
}

function startMockApi() {
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    requests.push({ method: request.method, url: request.url, headers: request.headers, body });
    response.setHeader('content-type', 'application/json');
    if (request.url === '/api/contributions/skill-package') {
      response.writeHead(201);
      response.end(JSON.stringify({
        sha256: 'b'.repeat(64),
        filename: '周报-Skill.zip',
        fileCount: 2,
        totalBytes: body.length,
        content: '# 角色',
        suggested: { name: '周报 Skill', description: '自动汇总周报并输出可执行结论' },
        validation: { valid: true, checks: [], issues: [], warnings: [] },
      }));
      return;
    }
    if (request.url === '/api/contributions') {
      response.writeHead(201);
      response.end(JSON.stringify({ id: 'contribution-1', status: 'DRAFT' }));
      return;
    }
    response.writeHead(404);
    response.end(JSON.stringify({ message: 'not found' }));
  });
  return { server, requests };
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return `http://127.0.0.1:${address.port}/api`;
}

test('explicit Skill directory can be scanned, packaged, uploaded and used to create a draft', async (t) => {
  const { skill } = await fixture();
  const scanned = await scanSkillDirectory(skill, { tool: 'codex', scope: 'user' });
  const packaged = await packageSelectedSkill(skill, scanned);
  assert.equal(packaged.filename, '周报-Skill.zip');
  assert.deepEqual([...packaged.bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);

  const mock = startMockApi();
  const baseUrl = await listen(mock.server);
  t.after(() => mock.server.close());
  const parsed = await uploadSkillPackage({ file: packaged.bytes, filename: packaged.filename, baseUrl, token: 'test-token' });
  assert.equal(parsed.sha256, 'b'.repeat(64));
  const draft = await createContribution({
    baseUrl,
    token: 'test-token',
    parsed,
    industry: ['互联网'],
    position: ['运营'],
  });
  assert.equal(draft.id, 'contribution-1');

  assert.equal(mock.requests.length, 2);
  assert.equal(mock.requests[0].method, 'POST');
  assert.equal(mock.requests[0].url, '/api/contributions/skill-package');
  assert.equal(mock.requests[0].headers.authorization, 'Bearer test-token');
  assert.match(mock.requests[0].headers['content-type'], /^multipart\/form-data; boundary=/);
  assert.match(mock.requests[0].body.toString('utf8'), /filename=\"周报-Skill\.zip\"/);
  assert.deepEqual([...mock.requests[0].body.subarray(mock.requests[0].body.indexOf('PK\x03\x04'))].slice(0, 4), [0x50, 0x4b, 0x03, 0x04]);
  assert.equal(mock.requests[1].url, '/api/contributions');
  assert.equal(mock.requests[1].headers.authorization, 'Bearer test-token');
  const payload = JSON.parse(mock.requests[1].body.toString('utf8'));
  assert.deepEqual(payload.skillConfig, { packageSha256: 'b'.repeat(64), packageFilename: '周报-Skill.zip' });
  assert.equal(payload.type, 'skill');
  assert.equal('content' in payload.skillConfig, false);
});

test('stored ZIP is readable by a standard ZIP signature and rejects unsafe paths', () => {
  assert.throws(() => createStoredZip([{ name: '../secret.txt', data: 'secret' }]), /越界/);
  assert.throws(() => createStoredZip([{ name: '/secret.txt', data: 'secret' }]), /非法/);
});

test('upload requires an access token before making a request', async () => {
  await assert.rejects(
    uploadSkillPackage({ file: new Uint8Array([1]), baseUrl: 'http://127.0.0.1:1/api', token: '' }),
    /SEP_ACCESS_TOKEN/,
  );
});
