#!/usr/bin/env node
/**
 * SEP Skill CLI / local bridge.
 *
 * Commands:
 *   sep-skill scan [--scope all|user|project] [--agent claude,codex]
 *   sep-skill list
 *   sep-skill package <skill-directory> [--output skill.zip]
 *   sep-skill publish <skill-directory> [--name ...] [--description ...]
 *   sep-skill serve [--port 3210]
 *
 * The CLI never executes files in a Skill package. The bridge only exposes
 * localhost and forwards an explicitly selected package to the authenticated
 * SEP API; it does not retain access tokens.
 */
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { packageSkill, packageSkillById, scanSkills, SCANNER_VERSION } from './scanner.mjs';

const DEFAULT_PORT = 3210;
const DEFAULT_API_BASE = normalizeApiBase(process.env.SEP_API_BASE_URL || 'http://localhost:3001');

function normalizeApiBase(value) {
  const base = String(value).replace(/\/+$/, '');
  return /\/api$/i.test(base) ? base : `${base}/api`;
}

function parseArgs(argv) {
  const positionals = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) { positionals.push(value); continue; }
    const key = value.slice(2);
    if (key === 'json' || key === 'help') { options[key] = true; continue; }
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) options[key] = true;
    else { options[key] = next; index += 1; }
  }
  return { positionals, options };
}

async function scan(options = {}) {
  const agents = options.agent ? String(options.agent).split(',').map((item) => item.trim()).filter(Boolean) : undefined;
  return scanSkills({ scope: options.scope || 'all', agents });
}

function printHelp() {
  process.stdout.write(`SEP Skill CLI ${SCANNER_VERSION}\n\n` +
    `用法:\n` +
    `  sep-skill scan [--scope all|user|project] [--agent claude,codex]\n` +
    `  sep-skill list [--scope all|user|project]\n` +
    `  sep-skill package <skill-directory> [--output skill.zip]\n` +
    `  sep-skill publish <skill-directory> [--name 名称] [--description 说明]\n` +
    `  sep-skill serve [--port 3210]\n\n` +
    `环境变量:\n` +
    `  SEP_API_BASE_URL  平台 API 地址，默认 http://localhost:3001/api\n` +
    `  SEP_ACCESS_TOKEN  CLI publish 使用的短期 Access Token（不会写入文件）\n`);
}

async function publish(skillPath, options, authorization) {
  const { item, filename, buffer } = await packageSkill(skillPath, { source: 'cli', scope: 'user' });
  const apiBase = normalizeApiBase(options.api || DEFAULT_API_BASE);
  const headers = authorization ? { Authorization: authorization } : {};
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'application/zip' }), filename);
  const uploadResponse = await fetch(`${apiBase}/contributions/skill-package`, { method: 'POST', headers, body: form });
  const upload = await readResponse(uploadResponse);
  if (!uploadResponse.ok) throw new Error(`Skill 包上传失败（${uploadResponse.status}）：${messageOf(upload)}`);
  const body = {
    name: String(options.name || item.name),
    description: String(options.description || item.description || `通过 ${item.source} 本地扫描导入的 Skill`),
    type: 'skill', industry: [], position: [],
    skillConfig: { packageSha256: upload.sha256, packageFilename: upload.filename || filename },
  };
  const createResponse = await fetch(`${apiBase}/contributions`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const created = await readResponse(createResponse);
  if (!createResponse.ok) throw new Error(`投稿草稿创建失败（${createResponse.status}）：${messageOf(created)}`);
  return { item, package: upload, contribution: created };
}

async function readResponse(response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : undefined; } catch { return text; }
}
function messageOf(value) { return value && typeof value === 'object' && 'message' in value ? value.message : String(value || '请求失败'); }

function startBridge(port) {
  const server = createServer(async (request, response) => {
    setCors(response, request);
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
    try {
      const url = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`);
      if (request.method === 'GET' && url.pathname === '/health') return sendJson(response, 200, { ok: true, scannerVersion: SCANNER_VERSION });
      if (request.method === 'GET' && url.pathname === '/scan') {
        const items = await scan({ scope: url.searchParams.get('scope') || 'all', agent: url.searchParams.get('agent') || undefined });
        return sendJson(response, 200, { scannerVersion: SCANNER_VERSION, items });
      }
      if (request.method === 'GET' && url.pathname === '/package') {
        const id = url.searchParams.get('id');
        const result = await packageSkillById(id, { scope: url.searchParams.get('scope') || 'all', agent: url.searchParams.get('agent') || undefined });
        response.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(result.filename)}`, 'X-SEP-Skill-Sha256': result.item.sha256, 'Cache-Control': 'no-store' });
        response.end(result.buffer);
        return;
      }
      sendJson(response, 404, { message: 'Not Found' });
    } catch (error) {
      sendJson(response, 400, { message: error instanceof Error ? error.message : String(error) });
    }
  });
  server.listen(port, '127.0.0.1', () => process.stdout.write(`SEP Skill 本地桥接已启动：http://127.0.0.1:${port}\n`));
  return server;
}

function setCors(response, request) {
  const origin = request.headers.origin;
  const allowed = new Set((process.env.SEP_SKILL_ALLOWED_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000').split(',').map((item) => item.trim()).filter(Boolean));
  if (origin && allowed.has(origin)) response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Vary', 'Origin');
  response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.setHeader('Cache-Control', 'no-store');
}
function sendJson(response, status, payload) { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(payload)); }

const { positionals, options } = parseArgs(process.argv.slice(2));
const command = positionals[0] || 'help';
if (options.help || command === 'help') { printHelp(); }
else if (command === 'scan' || command === 'list') {
  const items = await scan(options);
  if (command === 'list' && !options.json) {
    for (const item of items) process.stdout.write(`${item.id.slice(0, 12)}\t${item.name}\t${item.source}\t${item.scope}\t${item.path}\n`);
  } else process.stdout.write(`${JSON.stringify({ scannerVersion: SCANNER_VERSION, items }, null, 2)}\n`);
}
else if (command === 'package') {
  const skillPath = positionals[1];
  if (!skillPath) throw new Error('请提供 Skill 目录');
  const result = await packageSkill(skillPath, { source: 'cli', scope: 'user' });
  const output = resolve(String(options.output || result.filename));
  await mkdir(dirname(output), { recursive: true }); await writeFile(output, result.buffer);
  process.stdout.write(`${JSON.stringify({ ...result.item, output, filename: result.filename }, null, 2)}\n`);
}
else if (command === 'publish') {
  const skillPath = positionals[1];
  if (!skillPath) throw new Error('请提供 Skill 目录');
  if (!process.env.SEP_ACCESS_TOKEN) throw new Error('请先设置 SEP_ACCESS_TOKEN；Token 仅从环境变量读取，不写入命令参数或日志');
  const result = await publish(skillPath, options, `Bearer ${process.env.SEP_ACCESS_TOKEN}`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
else if (command === 'serve') startBridge(Number(options.port || DEFAULT_PORT));
else { printHelp(); process.exitCode = 1; }
