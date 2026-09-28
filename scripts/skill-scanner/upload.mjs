#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { inspectSkillDirectory, scanSkills } from './scanner.mjs';
import { createStoredZip, normalizeArchivePath } from './zip.mjs';

const DEFAULT_API_URL = 'http://localhost:3001/api';
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export function parseArgs(argv, environment = process.env) {
  const args = {
    list: false,
    create: false,
    path: null,
    baseUrl: environment.SEP_API_URL || environment.SEP_BASE_URL || DEFAULT_API_URL,
    name: null,
    description: null,
    industry: [],
    position: [],
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--list') args.list = true;
    else if (arg === '--create') args.create = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--path' || arg === '-p') args.path = requiredValue(argv, ++index, arg);
    else if (arg === '--base-url') args.baseUrl = requiredValue(argv, ++index, arg);
    else if (arg === '--name') args.name = requiredValue(argv, ++index, arg);
    else if (arg === '--description') args.description = requiredValue(argv, ++index, arg);
    else if (arg === '--industry') args.industry = splitTags(requiredValue(argv, ++index, arg));
    else if (arg === '--position') args.position = splitTags(requiredValue(argv, ++index, arg));
    else throw new Error(`未知参数: ${arg}（使用 --help 查看用法）`);
  }
  return args;
}

export async function uploadSkillPackage({ file, filename: providedFilename, baseUrl, token, fetchImpl = fetch }) {
  if (!token) throw new Error('上传需要 SEP_ACCESS_TOKEN 环境变量');
  const bytes = file instanceof Uint8Array ? file : await readFile(file);
  if (bytes.length > MAX_UPLOAD_BYTES) throw new Error('技能包超过 20MB 上传限制');
  const filename = providedFilename || (typeof file === 'string' ? file.split(/[\\/]/).pop() || 'skill.zip' : 'skill.zip');
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'application/zip' }), filename);
  const response = await fetchImpl(endpoint(baseUrl, '/contributions/skill-package'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  return parseResponse(response, 'Skill 包上传');
}

export async function createContribution({ baseUrl, token, parsed, name, description, industry = [], position = [], fetchImpl = fetch }) {
  if (!token) throw new Error('创建投稿需要 SEP_ACCESS_TOKEN 环境变量');
  const resolvedName = (name || parsed.suggested?.name || stripExtension(parsed.filename) || '本地 Skill').trim();
  const resolvedDescription = (description || parsed.suggested?.description || '').trim();
  if (resolvedName.length < 1) throw new Error('投稿名称不能为空，请使用 --name 指定');
  if (resolvedDescription.length < 10) {
    throw new Error('投稿说明至少需要 10 个字，请使用 --description 指定，或在 SKILL.md frontmatter 中填写 description');
  }
  const body = {
    name: resolvedName,
    description: resolvedDescription,
    type: 'skill',
    industry,
    position,
    inputSchema: {},
    outputSchema: {},
    skillConfig: {
      packageSha256: parsed.sha256,
      packageFilename: parsed.filename,
    },
  };
  const response = await fetchImpl(endpoint(baseUrl, '/contributions'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return parseResponse(response, '创建投稿草稿');
}

export async function scanSelectedSkill(path, options = {}) {
  const result = await inspectSkillDirectory(path, options);
  return { ...result, absolutePath: resolve(path) };
}

export async function packageSelectedSkill(path, scanResult) {
  const root = resolve(path);
  const entries = await Promise.all(scanResult.files.map(async (relativePath) => ({
    name: normalizeArchivePath(relativePath),
    data: await readFile(join(root, relativePath)),
  })));
  const bytes = createStoredZip(entries);
  if (bytes.length > MAX_UPLOAD_BYTES) throw new Error('技能包超过 20MB 上传限制');
  const filename = `${safeFilename(scanResult.name)}.zip`;
  return { bytes, filename };
}

export async function run(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv, env);
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return null;
  }
  if (args.list) {
    const items = await scanSkills({ includeErrors: true });
    print(items, args.json);
    return items;
  }
  if (!args.path) throw new Error('请使用 --path 指定一个 Skill 目录，或使用 --list 扫描本机候选');
  const scanned = await scanSelectedSkill(args.path);
  const packaged = await packageSelectedSkill(args.path, scanned);
  const token = env.SEP_ACCESS_TOKEN || env.SEP_TOKEN;
  const parsed = await uploadSkillPackage({ file: packaged.bytes, filename: packaged.filename, baseUrl: args.baseUrl, token });
  const result = { upload: parsed, local: { name: scanned.name, path: resolve(args.path), files: scanned.files }, package: { filename: packaged.filename } };
  if (args.create) {
    result.contribution = await createContribution({
      baseUrl: args.baseUrl,
      token,
      parsed,
      name: args.name,
      description: args.description,
      industry: args.industry,
      position: args.position,
    });
  }
  print(result, args.json);
  return result;
}

function endpoint(baseUrl, path) {
  return `${String(baseUrl).replace(/\/+$/, '')}${path}`;
}

async function parseResponse(response, action) {
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = { message: text }; }
  if (!response.ok) {
    const message = data?.message || data?.error || `${action}失败（HTTP ${response.status}）`;
    throw new Error(`${action}失败: ${Array.isArray(message) ? message.join('；') : message}`);
  }
  return data;
}

function print(value, json) {
  if (json) process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  else if (value?.upload) {
    process.stdout.write(`上传成功\nsha256: ${value.upload.sha256}\n文件: ${value.upload.filename}\n校验: ${value.upload.validation?.valid ? '通过' : '未通过，请修正后再提交审核'}\n`);
    if (value.contribution) process.stdout.write(`投稿草稿: ${value.contribution.id || value.contribution.capability?.id || '已创建'}\n`);
  } else process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function requiredValue(argv, index, option) {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`${option} 需要一个值`);
  return value;
}
function splitTags(value) { return value.split(/[，,]/).map((item) => item.trim()).filter(Boolean); }
function stripExtension(value) { return value.replace(/\.zip$/i, ''); }
function safeFilename(value) {
  const cleaned = String(value).trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/\s+/g, '-');
  return (cleaned || 'skill').slice(0, 100);
}
function usage() {
  return `本地 Skill 上传工具\n\n用法:\n  node scripts/skill-scanner/upload.mjs --list [--json]\n  SEP_ACCESS_TOKEN=... node scripts/skill-scanner/upload.mjs --path <Skill目录> [选项]\n\n选项:\n  --create                 上传后创建能力贡献草稿\n  --name <名称>            覆盖能力名称\n  --description <说明>     覆盖能力说明（至少 10 个字）\n  --industry <标签>        行业标签，逗号分隔\n  --position <标签>        职位标签，逗号分隔\n  --base-url <地址>        API 根地址，默认 ${DEFAULT_API_URL}\n  --json                   输出机器可读 JSON\n  --help                   显示本帮助\n\n安全边界：只处理 --path 明确指定的目录，不执行 Skill 内脚本，不运行 npm/npx。`;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  run().catch((error) => {
    process.stderr.write(`错误: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
