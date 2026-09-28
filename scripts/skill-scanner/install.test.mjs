import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStoredZip } from './zip.mjs';
import {
  downloadSkillVersion,
  installSkillVersion,
  downloadToFile,
  parseArgs,
} from './install.mjs';

const SKILL = '---\nname: 周报 Skill\ndescription: 自动生成周报和行动建议\n---\n# 角色\n你是周报助手\n';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'sep-skill-install-'));
  const bytes = createStoredZip([
    { name: 'weekly-report/SKILL.md', data: SKILL },
    { name: 'weekly-report/examples/sample.txt', data: 'sample' },
  ]);
  return { root, bytes };
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function startMockApi(bytes, { sha = sha256(bytes) } = {}) {
  const server = createServer((request, response) => {
    if (request.url !== '/api/contributions/versions/v1/package') {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      'content-type': 'application/zip',
      'content-disposition': "attachment; filename*=UTF-8''weekly-report.zip",
      'x-sha256': sha,
      'x-version': '1.2.3',
    });
    response.end(Buffer.from(bytes));
  });
  return server;
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return `http://127.0.0.1:${address.port}/api`;
}

test('downloads with bearer token and verifies the server SHA-256', async (t) => {
  const { root, bytes } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const server = startMockApi(bytes);
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const result = await downloadSkillVersion({
    versionId: 'v1',
    baseUrl,
    token: 'test-token',
  });
  assert.equal(result.filename, 'weekly-report.zip');
  assert.equal(result.version, '1.2.3');
  assert.equal(result.sha256, sha256(bytes));
  assert.deepEqual([...result.bytes], [...bytes]);
});

test('rejects a missing or mismatched server SHA-256', async () => {
  const bytes = createStoredZip([{ name: 'SKILL.md', data: SKILL }]);
  await assert.rejects(
    downloadSkillVersion({
      versionId: 'v1',
      baseUrl: 'http://unused/api',
      token: 'test-token',
      fetchImpl: async () => new Response(bytes, { status: 200, headers: { 'content-disposition': 'attachment; filename=skill.zip' } }),
    }),
    /缺少合法的 X-SHA256/,
  );
  await assert.rejects(
    downloadSkillVersion({
      versionId: 'v1',
      baseUrl: 'http://unused/api',
      token: 'test-token',
      fetchImpl: async () => new Response(bytes, { status: 200, headers: { 'x-sha256': 'a'.repeat(64) } }),
    }),
    /SHA-256 校验失败/,
  );
});

test('installs only after verification, strips a single package root, and never runs files', async (t) => {
  const { root, bytes } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const result = await installSkillVersion({
    download: { bytes, filename: 'weekly-report.zip', versionId: 'v1', version: '1.2.3', sha256: sha256(bytes) },
    tool: 'codex',
    home: root,
  });
  const skillRoot = join(root, '.agents', 'skills', 'weekly-report');
  assert.equal(result.target, await realpath(skillRoot));
  assert.equal(await readFile(join(skillRoot, 'SKILL.md'), 'utf8'), SKILL);
  assert.equal(await readFile(join(skillRoot, 'examples', 'sample.txt'), 'utf8'), 'sample');
  assert.equal(result.installed, true);
});

test('rejects an existing target and does not overwrite it', async (t) => {
  const { root, bytes } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = join(root, '.claude', 'skills', 'weekly-report');
  await writeFile(join(await mkdirp(target), 'SKILL.md'), 'user content');
  await assert.rejects(
    installSkillVersion({
      download: { bytes, filename: 'weekly-report.zip', versionId: 'v1', sha256: sha256(bytes) },
      tool: 'claude',
      home: root,
    }),
    /已存在/,
  );
  assert.equal(await readFile(join(target, 'SKILL.md'), 'utf8'), 'user content');
});

test('rejects a path traversal entry before writing anything', async (t) => {
  const { root, bytes } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const malicious = new Uint8Array(bytes);
  const replacement = Buffer.from('a/../SKILL.md');
  const original = Buffer.from('weekly-report/SKILL.md');
  for (let offset = 0; offset <= malicious.length - original.length; offset += 1) {
    if (Buffer.from(malicious.slice(offset, offset + original.length)).equals(original)) malicious.set(replacement, offset);
  }
  await assert.rejects(
    installSkillVersion({
      download: { bytes: malicious, filename: 'weekly-report.zip', versionId: 'v1', sha256: sha256(malicious) },
      tool: 'gemini',
      home: root,
    }),
    /路径越界/,
  );
});

test('downloadToFile refuses overwrite and parseArgs keeps token out of output', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sep-skill-download-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bytes = createStoredZip([{ name: 'SKILL.md', data: SKILL }]);
  const download = { bytes, filename: 'skill.zip', sha256: sha256(bytes), versionId: 'v1', version: '1.0.0' };
  await downloadToFile({ download, outputPath: join(root, 'skill.zip') });
  await assert.rejects(downloadToFile({ download, outputPath: join(root, 'skill.zip') }), /已存在/);
  const args = parseArgs(['install', '--version', 'v1', '--tool', 'codex'], { SEP_ACCESS_TOKEN: 'secret' });
  assert.equal(args.token, 'secret');
  assert.equal(JSON.stringify(args).includes('secret'), true);
});

async function mkdirp(path) {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(path, { recursive: true });
  return path;
}
