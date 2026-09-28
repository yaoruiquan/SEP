#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { homedir, platform as osPlatform } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';

export const SCANNER_VERSION = '0.2.0';
export const MAX_FILES = 2000;
export const MAX_BYTES = 20 * 1024 * 1024;
const SKILL_FILE = 'SKILL.md';

/**
 * Agent Skills 的本地目录目录表。路径只用于发现，不代表会读取目录之外的文件。
 * 参考开源 skills CLI 的 project/global scope 思路，同时保留各 Agent 的公开约定。
 */
export function discoverRoots({ home = homedir(), cwd = process.cwd(), platform = osPlatform(), scope = 'all', agents } = {}) {
  const normalizedAgents = agents?.length ? new Set(agents.map(normalizeAgent)) : null;
  const projectRoots = scope === 'user' ? [] : ancestorDirectories(resolve(cwd)).flatMap((directory) => [
    [join(directory, '.agents', 'skills'), 'agents', 'project'],
    [join(directory, '.claude', 'skills'), 'claude-code', 'project'],
    [join(directory, '.gemini', 'skills'), 'gemini-cli', 'project'],
    [join(directory, '.opencode', 'skills'), 'opencode', 'project'],
    [join(directory, '.opencode', 'skill'), 'opencode', 'project'],
    [join(directory, 'skills'), 'agents', 'project'],
  ]);
  const opencodeUserRoots = platform === 'win32'
    ? [
        [join(home, 'AppData', 'Roaming', 'opencode', 'skills'), 'opencode', 'user'],
        [join(home, 'AppData', 'Local', 'opencode', 'skills'), 'opencode', 'user'],
      ]
    : [
        [join(home, '.config', 'opencode', 'skills'), 'opencode', 'user'],
        [join(home, '.config', 'opencode', 'skill'), 'opencode', 'user'],
        ...(platform === 'darwin' ? [[join(home, 'Library', 'Application Support', 'opencode', 'skills'), 'opencode', 'user']] : []),
      ];
  const userRoots = scope === 'project' ? [] : [
    [join(home, '.agents', 'skills'), 'agents', 'user'],
    [join(home, '.claude', 'skills'), 'claude-code', 'user'],
    [join(home, '.codex', 'skills'), 'codex', 'user'],
    [join(home, '.gemini', 'skills'), 'gemini-cli', 'user'],
    ...opencodeUserRoots,
  ];
  const roots = [...projectRoots, ...userRoots]
    .filter(([, tool]) => !normalizedAgents || normalizedAgents.has(tool) || (tool === 'agents' && normalizedAgents.has('generic')))
    .map(([root, tool, rootScope]) => ({ root, scope: rootScope, tool }));
  return uniqueRoots(roots);
}

function ancestorDirectories(start) {
  const directories = [];
  let current = start;
  while (true) {
    directories.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return directories;
}

function uniqueRoots(roots) {
  const seen = new Set();
  return roots.filter((item) => {
    const key = `${resolve(item.root)}:${item.scope}:${item.tool}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeAgent(agent) {
  const value = String(agent).trim().toLowerCase();
  return ({ claude: 'claude-code', 'claude-code': 'claude-code', codex: 'codex', gemini: 'gemini-cli', 'gemini-cli': 'gemini-cli', opencode: 'opencode', agents: 'agents', generic: 'generic' })[value] ?? value;
}

export async function scanSkills(options = {}) {
  const roots = options.roots ?? discoverRoots(options);
  const result = [];
  for (const rootInfo of roots) result.push(...await scanRoot(rootInfo, options));
  const seen = new Set();
  return result.filter((item) => {
    const key = `${item.sha256}:${item.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function scanRoot(rootInfo, options) {
  const root = resolve(rootInfo.root);
  if (!(await isDirectory(root)) || !(await isSafeDirectory(root, root))) return [];
  const output = [];
  // 兼容 skills 根目录本身就是一个 Skill 的导入方式。
  const rootSkill = join(root, SKILL_FILE);
  if (await isRegularFile(rootSkill) && await isSafePath(rootSkill, root)) {
    try { output.push(await inspectSkill(root, rootSkill, rootInfo, options)); } catch (error) { if (options.includeErrors) output.push(errorItem(root, rootInfo, error)); }
  }
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const skillDir = join(root, entry.name);
    if (!(await isSafeDirectory(skillDir, root))) continue;
    const skillFile = join(skillDir, SKILL_FILE);
    if (!(await isRegularFile(skillFile)) || !(await isSafePath(skillFile, root))) continue;
    try { output.push(await inspectSkill(skillDir, skillFile, rootInfo, options)); } catch (error) { if (options.includeErrors) output.push(errorItem(skillDir, rootInfo, error)); }
  }
  return output;
}

function errorItem(path, rootInfo, error) {
  return { id: null, path, source: rootInfo.tool, scope: rootInfo.scope, error: error instanceof Error ? error.message : String(error) };
}

export async function inspectSkillDirectory(skillDir, metadata = {}) {
  const directory = resolve(skillDir);
  const skillFile = join(directory, SKILL_FILE);
  if (!(await isDirectory(directory)) || !(await isRegularFile(skillFile)) || !(await isSafePath(skillFile, directory))) {
    throw new Error(`不是有效的 Skill 目录：${skillDir}`);
  }
  return inspectSkill(directory, skillFile, { source: metadata.source ?? inferTool(directory), scope: metadata.scope ?? 'user' }, metadata);
}

async function inspectSkill(skillDir, skillFile, rootInfo, options) {
  const files = [];
  let totalBytes = 0;
  await walk(skillDir, skillDir, files, (filePath) => {
    totalBytes += filePath.size;
    if (totalBytes > (options.maxBytes ?? MAX_BYTES)) throw new Error(`技能包超过 ${options.maxBytes ?? MAX_BYTES} 字节限制`);
  }, options.maxFiles ?? MAX_FILES);
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file.relativePath); hash.update('\0'); hash.update(await readFile(file.absolutePath)); hash.update('\0');
  }
  const sha256 = hash.digest('hex');
  const content = await readFile(skillFile, 'utf8');
  const metadata = parseFrontmatter(content);
  return {
    id: sha256,
    name: metadata.name || basenameFallback(skillDir),
    description: metadata.description || null,
    path: skillDir,
    source: rootInfo.tool,
    scope: rootInfo.scope,
    sha256,
    fileCount: files.length,
    totalBytes,
    files: files.map((file) => file.relativePath),
  };
}


async function walk(current, base, files, onFile, maxFiles) {
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = join(current, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) { if (!(await isSafePath(absolutePath, base))) continue; await walk(absolutePath, base, files, onFile, maxFiles); continue; }
    if (!entry.isFile() || !(await isSafePath(absolutePath, base))) continue;
    const stat = await lstat(absolutePath);
    const item = { absolutePath, relativePath: relative(base, absolutePath).split(sep).join('/'), size: stat.size };
    files.push(item);
    if (files.length > maxFiles) throw new Error(`技能包文件数超过 ${maxFiles}`);
    onFile(item);
  }
}

export function parseFrontmatter(content) {
  if (!content.startsWith('---')) return {};
  const end = content.indexOf('\n---', 3);
  if (end < 0) return {};
  const fields = {};
  for (const line of content.slice(4, end).split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z][\w-]*)\s*:\s*(.*)$/);
    if (!match) continue;
    fields[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '') || null;
  }
  return fields;
}

export async function packageSkillById(id, options = {}) {
  if (!/^[0-9a-f]{64}$/.test(String(id))) throw new Error('Skill id 无效');
  const items = await scanSkills(options);
  const item = items.find((candidate) => candidate.id === id);
  if (!item) throw new Error('扫描结果已变化，请重新扫描本地 Skills');
  return packageSkill(item.path, item);
}

export async function packageSkill(skillDir, options = {}) {
  const item = await inspectSkillDirectory(skillDir, options);
  const files = [];
  await collectFiles(resolve(skillDir), resolve(skillDir), files, options.maxFiles ?? MAX_FILES);
  const entries = await Promise.all(files.map(async ({ absolutePath, relativePath }) => ({ name: relativePath, data: new Uint8Array(await readFile(absolutePath)) })));
  return { item, filename: `${safeFilename(item.name)}.zip`, buffer: createStoredZip(entries) };
}

async function collectFiles(current, base, output, maxFiles) {
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = join(current, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) { if (await isSafePath(absolutePath, base)) await collectFiles(absolutePath, base, output, maxFiles); continue; }
    if (!entry.isFile() || !(await isSafePath(absolutePath, base))) continue;
    output.push({ absolutePath, relativePath: relative(base, absolutePath).split(sep).join('/') });
    if (output.length > maxFiles) throw new Error(`技能包文件数超过 ${maxFiles}`);
  }
  output.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function createStoredZip(entries) {
  const locals = [], centrals = []; let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name.replaceAll('\\', '/'));
    const data = Buffer.from(entry.data); const crc = crc32(data);
    const local = Buffer.alloc(30 + name.length); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(0, 8); local.writeUInt16LE(0, 10); local.writeUInt16LE(0, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28); name.copy(local, 30);
    locals.push(local, data);
    const central = Buffer.alloc(46 + name.length); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0, 8); central.writeUInt16LE(0, 10); central.writeUInt16LE(0, 12); central.writeUInt16LE(0, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt16LE(0, 30); central.writeUInt16LE(0, 32); central.writeUInt16LE(0, 34); central.writeUInt16LE(0, 36); central.writeUInt32LE(0, 38); central.writeUInt32LE(offset, 42); name.copy(central, 46); centrals.push(central); offset += local.length + data.length;
  }
  const central = Buffer.concat(centrals); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(centrals.length, 8); end.writeUInt16LE(centrals.length, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16); return Buffer.concat([...locals, central, end]);
}

function crc32(buffer) { let crc = 0xffffffff; for (const byte of buffer) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ 0xffffffff) >>> 0; }
function safeFilename(value) { return (value || 'skill').replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'skill'; }
async function isSafeDirectory(path, root) { return isSafePath(path, root) && (await isDirectory(path)); }
async function isSafePath(path, root) { try { const [real, base] = await Promise.all([realpath(path), realpath(root)]); return real === base || real.startsWith(base + sep); } catch { return false; } }
async function isDirectory(path) { try { return (await lstat(path)).isDirectory(); } catch { return false; } }
async function isRegularFile(path) { try { return (await lstat(path)).isFile(); } catch { return false; } }
function basenameFallback(path) { return path.split(/[\\/]/).filter(Boolean).pop() || 'skill'; }
function inferTool(root) { const normalized = root.replaceAll('\\', '/'); if (normalized.includes('/.claude/')) return 'claude-code'; if (normalized.includes('/.codex/')) return 'codex'; if (normalized.includes('/.gemini/')) return 'gemini-cli'; if (normalized.includes('/.opencode/')) return 'opencode'; return 'agents'; }

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const args = new Set(process.argv.slice(2));
  const output = await scanSkills({ includeErrors: args.has('--include-errors') });
  process.stdout.write(`${JSON.stringify({ scannerVersion: SCANNER_VERSION, items: output }, null, 2)}\n`);
}
