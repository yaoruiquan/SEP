#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import {
  access,
  constants,
  realpath,
  mkdir,
  mkdtemp,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_API_URL = 'http://localhost:3001/api';
const MAX_PACKAGE_BYTES = 20 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 500;
const ZIP_EOCD = 0x06054b50;
const ZIP_CENTRAL = 0x02014b50;
const ZIP_LOCAL = 0x04034b50;

const TOOL_ROOTS = Object.freeze({
  codex: (home) => join(home, '.agents', 'skills'),
  claude: (home) => join(home, '.claude', 'skills'),
  gemini: (home) => join(home, '.gemini', 'skills'),
  agents: (home) => join(home, '.agents', 'skills'),
});

export function parseArgs(argv, environment = process.env) {
  const args = {
    command: argv[0] === 'download' || argv[0] === 'install' ? argv[0] : 'install',
    versionId: null,
    tool: null,
    target: null,
    output: null,
    baseUrl: environment.SEP_API_URL || environment.SEP_BASE_URL || DEFAULT_API_URL,
    token: environment.SEP_ACCESS_TOKEN || environment.SEP_TOKEN || '',
    json: false,
    help: false,
  };
  let start = args.command === argv[0] ? 1 : 0;
  for (let index = start; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--version' || arg === '--version-id' || arg === '-v') args.versionId = requiredValue(argv, ++index, arg);
    else if (arg === '--tool' || arg === '-t') args.tool = requiredValue(argv, ++index, arg).toLowerCase();
    else if (arg === '--target') args.target = requiredValue(argv, ++index, arg);
    else if (arg === '--output' || arg === '-o') args.output = requiredValue(argv, ++index, arg);
    else if (arg === '--base-url') args.baseUrl = requiredValue(argv, ++index, arg);
    else if (arg === '--token') args.token = requiredValue(argv, ++index, arg);
    else if (!args.versionId && !arg.startsWith('-')) args.versionId = arg;
    else throw new Error(`未知参数: ${arg}（使用 --help 查看用法）`);
  }
  return args;
}

export async function downloadSkillVersion({
  versionId,
  baseUrl,
  token,
  fetchImpl = fetch,
}) {
  if (!versionId) throw new Error('必须指定版本 ID（使用 --version <versionId>）');
  if (!token) throw new Error('下载需要 SEP_ACCESS_TOKEN 环境变量或 --token');

  const response = await fetchImpl(endpoint(baseUrl, `/contributions/versions/${encodeURIComponent(versionId)}/package`), {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(await responseError(response, '下载 Skill 包'));

  const expectedSha256 = response.headers.get('x-sha256')?.trim().toLowerCase() || '';
  if (!/^[0-9a-f]{64}$/.test(expectedSha256)) {
    throw new Error('下载响应缺少合法的 X-SHA256，已拒绝安装');
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > MAX_PACKAGE_BYTES) throw new Error('下载的 Skill 包超过 20MB 限制');
  const actualSha256 = createHash('sha256').update(bytes).digest('hex');
  if (actualSha256 !== expectedSha256) {
    throw new Error(`SHA-256 校验失败：服务端 ${expectedSha256}，本地 ${actualSha256}`);
  }

  return {
    bytes,
    filename: safeFilename(parseContentDisposition(response.headers.get('content-disposition')) || 'skill.zip'),
    sha256: actualSha256,
    versionId,
    version: response.headers.get('x-version') || null,
  };
}

export async function downloadToFile({ download, outputPath, force = false }) {
  const target = resolve(outputPath || download.filename);
  if (!force && await exists(target)) throw new Error(`目标文件已存在，为避免覆盖：${target}`);
  await mkdir(dirname(target), { recursive: true });
  try {
    await writeFile(target, download.bytes, { flag: force ? 'w' : 'wx', mode: 0o600 });
  } catch (error) {
    if (!force && (error?.code === 'EEXIST' || error?.code === 'ENOTEMPTY')) {
      throw new Error(`目标文件已存在，为避免覆盖：${target}`);
    }
    throw error;
  }
  return { ...download, outputPath: target };
}

export async function installSkillVersion({
  download,
  tool,
  target,
  home = homedir(),
}) {
  const verifiedSha256 = createHash('sha256').update(download.bytes).digest('hex');
  if (!/^[0-9a-f]{64}$/.test(download.sha256 || '') || verifiedSha256 !== download.sha256) {
    throw new Error('安装前 SHA-256 校验失败');
  }
  const root = toolRoot(tool, home);
  await mkdir(root, { recursive: true, mode: 0o755 });
  const rootReal = await realpath(root);
  const skillName = target ? null : skillNameFromFilename(download.filename);
  const destination = resolve(target || join(rootReal, skillName));
  assertInside(destination, rootReal, '安装目录');
  if (await exists(destination)) throw new Error(`安装目录已存在，为避免覆盖：${destination}`);
  await assertParentInside(destination, rootReal);

  const entries = parseZip(download.bytes);
  const files = entries.filter((entry) => !entry.directory);
  if (files.length === 0) throw new Error('Skill 包没有可安装的文件');
  const skillEntries = files.filter((entry) => basename(entry.name) === 'SKILL.md');
  if (skillEntries.length !== 1) throw new Error('Skill 包必须且只能包含一个 SKILL.md');
  const prefix = dirname(skillEntries[0].name);
  const normalizedFiles = files.map((entry) => ({
    ...entry,
    name: stripPackageRoot(entry.name, prefix),
  }));
  if (!normalizedFiles.some((entry) => entry.name === 'SKILL.md')) {
    throw new Error('Skill 包的 SKILL.md 必须位于安装根目录');
  }

  const temporary = await mkdtemp(join(dirname(destination), `.${basename(destination)}.install-`));
  try {
    for (const entry of normalizedFiles) {
      const output = resolve(join(temporary, entry.name));
      assertInside(output, temporary, 'ZIP 条目');
      await mkdir(dirname(output), { recursive: true, mode: 0o755 });
      await writeFile(output, entry.data, { flag: 'wx', mode: 0o644 });
    }
    // 同一父目录内 rename，避免安装过程中出现半成品目标目录。
    try {
      await rename(temporary, destination);
    } catch (error) {
      if (error?.code === 'EEXIST' || error?.code === 'ENOTEMPTY') {
        throw new Error(`安装目录已存在，为避免覆盖：${destination}`);
      }
      throw error;
    }
    return {
      versionId: download.versionId,
      version: download.version,
      sha256: download.sha256,
      tool,
      target: destination,
      installed: true,
      fileCount: normalizedFiles.length,
    };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

export async function run(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv, env);
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return null;
  }
  const download = await downloadSkillVersion({
    versionId: args.versionId,
    baseUrl: args.baseUrl,
    token: args.token,
  });
  const result = args.command === 'download'
    ? await downloadToFile({ download, outputPath: args.output })
    : await installSkillVersion({ download, tool: args.tool, target: args.target });
  print(result, args.json, args.command);
  return result;
}

function parseZip(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 22) throw new Error('下载内容不是有效的 ZIP');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findSignature(bytes, ZIP_EOCD);
  if (eocd < 0) throw new Error('ZIP 缺少结束记录');
  const disk = view.getUint16(eocd + 4, true);
  const centralDisk = view.getUint16(eocd + 6, true);
  const count = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (disk !== 0 || centralDisk !== 0 || count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new Error('不支持多磁盘或 ZIP64 格式');
  }
  if (count > MAX_ENTRIES || centralOffset + centralSize > bytes.length) throw new Error('ZIP 目录非法或条目过多');

  const entries = [];
  let cursor = centralOffset;
  let totalUncompressed = 0;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== ZIP_CENTRAL) throw new Error('ZIP 中央目录损坏');
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const end = cursor + 46 + nameLength + extraLength + commentLength;
    if (end > bytes.length || localOffset >= bytes.length) throw new Error('ZIP 条目边界非法');
    const name = decodeName(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    const directory = name.endsWith('/') || name.endsWith('\\');
    const safeName = normalizeZipPath(directory ? name.slice(0, -1) : name) + (directory ? '/' : '');
    if (flags & 0x1) throw new Error(`ZIP 条目已加密：${safeName}`);
    if (method !== 0 && method !== 8 && !directory) throw new Error(`不支持的 ZIP 压缩方式：${safeName}`);
    if (uncompressedSize > MAX_UNCOMPRESSED_BYTES || totalUncompressed + uncompressedSize > MAX_UNCOMPRESSED_BYTES) {
      throw new Error('ZIP 解压后体积超过 64MB 限制');
    }
    entries.push({ name: safeName, directory, method, compressedSize, uncompressedSize, localOffset });
    totalUncompressed += uncompressedSize;
    cursor = end;
  }

  const seen = new Set();
  return entries.map((entry) => {
    if (seen.has(entry.name)) throw new Error(`ZIP 中存在重复路径：${entry.name}`);
    seen.add(entry.name);
    if (entry.directory) return entry;
    const local = entry.localOffset;
    if (local + 30 > bytes.length || view.getUint32(local, true) !== ZIP_LOCAL) throw new Error(`ZIP 条目头损坏：${entry.name}`);
    const localNameLength = view.getUint16(local + 26, true);
    const localExtraLength = view.getUint16(local + 28, true);
    const start = local + 30 + localNameLength + localExtraLength;
    const end = start + entry.compressedSize;
    if (end > bytes.length) throw new Error(`ZIP 条目数据越界：${entry.name}`);
    const compressed = bytes.subarray(start, end);
    let data;
    try {
      data = entry.method === 0 ? new Uint8Array(compressed) : new Uint8Array(inflateRawSync(compressed, { maxOutputLength: MAX_UNCOMPRESSED_BYTES }));
    } catch {
      throw new Error(`ZIP 条目解压失败：${entry.name}`);
    }
    if (data.length !== entry.uncompressedSize) throw new Error(`ZIP 条目大小校验失败：${entry.name}`);
    return { ...entry, data };
  });
}

function stripPackageRoot(name, prefix) {
  const value = prefix ? `${prefix}/` : '';
  if (value && name !== prefix && !name.startsWith(value)) {
    throw new Error('ZIP 包内文件必须位于同一个 Skill 根目录下');
  }
  const stripped = value ? name.slice(value.length) : name;
  if (!stripped || stripped.endsWith('/')) throw new Error(`ZIP 条目路径非法：${name}`);
  return normalizeZipPath(stripped);
}

function normalizeZipPath(value) {
  const normalized = String(value).replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) throw new Error(`ZIP 条目路径非法：${value}`);
  const parts = normalized.split('/');
  if (parts.some((part) => !part || part === '..' || part === '.')) throw new Error(`ZIP 条目路径越界：${value}`);
  return parts.join('/');
}

function findSignature(bytes, signature) {
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 22 - 0xffff); index -= 1) {
    if (index >= 0 && new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(index, true) === signature) return index;
  }
  return -1;
}

function decodeName(bytes) {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function toolRoot(tool, home) {
  if (!tool || !TOOL_ROOTS[tool]) throw new Error(`必须指定受支持的 --tool：${Object.keys(TOOL_ROOTS).join('、')}`);
  return resolve(TOOL_ROOTS[tool](home));
}

function skillNameFromFilename(filename) {
  const value = safeFilename(filename).replace(/\.zip$/i, '').trim();
  if (!value || value === '.' || value === '..') throw new Error('无法从包文件名得到安全的 Skill 目录名，请使用 --target');
  return value;
}

function safeFilename(value) {
  const base = String(value || '').replaceAll('\\', '/').split('/').pop() || 'skill.zip';
  const cleaned = base.replace(/[\u0000-\u001f<>:"/\\|?*]/g, '-').trim();
  return cleaned || 'skill.zip';
}

function parseContentDisposition(value) {
  if (!value) return null;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(value);
  const plain = /filename="([^"]+)"/i.exec(value) || /filename=([^;]+)/i.exec(value);
  const raw = star?.[1] || plain?.[1]?.trim();
  if (!raw) return null;
  try { return decodeURIComponent(raw); } catch { return raw; }
}

function assertInside(target, root, label) {
  const resolvedTarget = resolve(target);
  const resolvedRoot = resolve(root);
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(resolvedRoot + sep)) throw new Error(`${label}必须位于允许目录内`);
}

async function assertParentInside(target, root) {
  const parent = resolve(dirname(target));
  assertInside(parent, root, '安装目录父级');
  await mkdir(parent, { recursive: true, mode: 0o755 });
  const parentReal = await realpath(parent);
  assertInside(parentReal, root, '安装目录父级');
}

async function exists(path) {
  try { await access(path, constants.F_OK); return true; } catch { return false; }
}

async function responseError(response, action) {
  let message = '';
  try {
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    message = data?.message || data?.error || text;
  } catch { /* ignore malformed error bodies */ }
  return `${action}失败${message ? `: ${Array.isArray(message) ? message.join('；') : message}` : `（HTTP ${response.status}）`}`;
}

function endpoint(baseUrl, path) { return `${String(baseUrl).replace(/\/+$/, '')}${path}`; }
function requiredValue(argv, index, option) {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`${option} 需要一个值`);
  return value;
}
function basename(path) { return path.split('/').pop() || ''; }
function print(value, json, command) {
  if (json) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  process.stdout.write(`下载成功\n版本：${value.version || value.versionId}\nSHA-256 校验：通过\n`);
  if (command === 'download') process.stdout.write(`文件：${value.outputPath}\n`);
  else process.stdout.write(`工具：${value.tool}\n目标：${value.target}\n安装成功\n`);
}
function usage() {
  return `已发布 Skill 下载/安装工具\n\n用法:\n  SEP_ACCESS_TOKEN=... node scripts/skill-scanner/install.mjs download --version <versionId> [--output <file>]\n  SEP_ACCESS_TOKEN=... node scripts/skill-scanner/install.mjs install --version <versionId> --tool <codex|claude|gemini|agents> [--target <dir>]\n\n选项:\n  --tool <工具>       安装目标工具（安装时必填）\n  --target <目录>     覆盖默认 Skill 目录，但仍必须位于该工具允许根目录内\n  --output <文件>     download 命令的输出 ZIP 路径\n  --base-url <地址>   API 根地址，默认 ${DEFAULT_API_URL}\n  --token <token>     访问令牌（优先使用 SEP_ACCESS_TOKEN 环境变量）\n  --json              输出机器可读 JSON\n  --help              显示本帮助\n\n安全边界：只安装服务端已发布版本；下载后强制 SHA-256 校验；拒绝路径穿越、加密 ZIP、缺少 SKILL.md 和覆盖已有目录；绝不执行包内脚本。`;
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  run().catch((error) => {
    process.stderr.write(`错误: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
