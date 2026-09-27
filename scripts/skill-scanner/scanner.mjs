#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { homedir, platform as osPlatform } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';

const MAX_FILES = 2000;
const MAX_BYTES = 20 * 1024 * 1024;
const SKILL_FILE = 'SKILL.md';

export function discoverRoots({ home = homedir(), cwd = process.cwd(), platform = osPlatform() } = {}) {
  const user = [
    join(home, '.agents', 'skills'),
    join(home, '.claude', 'skills'),
    join(home, '.codex', 'skills'),
    join(home, '.gemini', 'skills'),
    join(home, '.config', 'opencode', 'skills'),
    join(home, '.config', 'opencode', 'skill'),
  ];
  const project = [
    join(cwd, '.agents', 'skills'),
    join(cwd, '.claude', 'skills'),
    join(cwd, '.codex', 'skills'),
    join(cwd, '.gemini', 'skills'),
    join(cwd, '.opencode', 'skills'),
    join(cwd, '.opencode', 'skill'),
  ];
  // Keep the argument so callers can record the scanner environment; the paths are
  // intentionally XDG-style and work on Windows when home/cwd are supplied.
  void platform;
  return [...new Set([...project, ...user])].map((root) => ({
    root,
    scope: root.startsWith(resolve(cwd) + sep) || root === resolve(cwd) ? 'project' : 'user',
    tool: inferTool(root),
  }));
}

function inferTool(root) {
  const normalized = root.replaceAll('\\', '/');
  if (normalized.includes('/.claude/')) return 'claude-code';
  if (normalized.includes('/.codex/')) return 'codex';
  if (normalized.includes('/.gemini/')) return 'gemini-cli';
  if (normalized.includes('/.opencode/')) return 'opencode';
  return 'agents';
}

export async function scanSkills(options = {}) {
  const roots = options.roots ?? discoverRoots(options);
  const result = [];
  for (const rootInfo of roots) {
    result.push(...await scanRoot(rootInfo, options));
  }
  const seen = new Set();
  return result.filter((item) => {
    const key = `${item.sha256}:${item.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * 扫描用户明确指定的单个 Skill 目录。
 *
 * 与 scanSkills 的自动发现不同，这个 API 只读取调用方给出的目录，供 CLI
 * 在用户明确选择 --path 后打包上传；不会执行目录中的任何脚本。
 */
export async function scanSkillDirectory(skillPath, options = {}) {
  const skillDir = resolve(skillPath);
  if (!(await isSafeDirectory(skillDir, skillDir))) {
    throw new Error(`不是可读取的 Skill 目录: ${skillPath}`);
  }
  const skillFile = join(skillDir, SKILL_FILE);
  if (!(await isRegularFile(skillFile)) || !(await isSafePath(skillFile, skillDir))) {
    throw new Error(`Skill 目录必须包含 ${SKILL_FILE}: ${skillPath}`);
  }
  const cwd = resolve(options.cwd ?? process.cwd());
  const rootInfo = options.rootInfo ?? {
    root: dirname(skillDir),
    scope: options.scope ?? (skillDir === cwd || skillDir.startsWith(`${cwd}${sep}`) ? 'project' : 'user'),
    tool: options.tool ?? inferTool(skillDir),
  };
  return inspectSkill(skillDir, skillFile, rootInfo, options);
}

async function scanRoot(rootInfo, options) {
  const root = resolve(rootInfo.root);
  if (!(await isDirectory(root)) || !(await isSafeDirectory(root, root))) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const output = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const skillDir = join(root, entry.name);
    if (!(await isSafeDirectory(skillDir, root))) continue;
    const skillFile = join(skillDir, SKILL_FILE);
    if (!(await isRegularFile(skillFile)) || !(await isSafePath(skillFile, root))) continue;
    try {
      output.push(await inspectSkill(skillDir, skillFile, rootInfo, options));
    } catch (error) {
      if (options.includeErrors) output.push({ path: skillDir, source: rootInfo.tool, scope: rootInfo.scope, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return output;
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
    hash.update(file.relativePath);
    hash.update('\0');
    hash.update(await readFile(file.absolutePath));
    hash.update('\0');
  }
  const content = await readFile(skillFile, 'utf8');
  const metadata = parseFrontmatter(content);
  return {
    name: metadata.name || basenameFallback(skillDir),
    description: metadata.description || null,
    path: skillDir,
    source: rootInfo.tool,
    scope: rootInfo.scope,
    sha256: hash.digest('hex'),
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
    if (entry.isDirectory()) {
      if (!(await isSafePath(absolutePath, base))) continue;
      await walk(absolutePath, base, files, onFile, maxFiles);
      continue;
    }
    if (!entry.isFile() || !(await isSafePath(absolutePath, base))) continue;
    const stat = await lstat(absolutePath);
    const item = { absolutePath, relativePath: relative(base, absolutePath).split(sep).join('/'), size: stat.size };
    files.push(item);
    if (files.length > maxFiles) throw new Error(`技能包文件数超过 ${maxFiles}`);
    onFile(item);
  }
}

function parseFrontmatter(content) {
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

async function isSafeDirectory(path, root) { return isSafePath(path, root) && (await isDirectory(path)); }
async function isSafePath(path, root) {
  try {
    const [real, base] = await Promise.all([realpath(path), realpath(root)]);
    return real === base || real.startsWith(base + sep);
  } catch { return false; }
}
async function isDirectory(path) { try { return (await lstat(path)).isDirectory(); } catch { return false; } }
async function isRegularFile(path) { try { return (await lstat(path)).isFile(); } catch { return false; } }
function basenameFallback(path) { return path.split(/[\\/]/).filter(Boolean).pop() || 'skill'; }

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const args = new Set(process.argv.slice(2));
  const output = await scanSkills({ includeErrors: args.has('--include-errors') });
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}
