import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanSkills } from './scanner.mjs';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'sep-skills-'));
  const skills = join(root, '.agents', 'skills');
  await mkdir(join(skills, 'weekly-report', 'examples'), { recursive: true });
  await writeFile(join(skills, 'weekly-report', 'SKILL.md'), '---\nname: Weekly Report\ndescription: Generate a weekly report\n---\n# Steps\n');
  await writeFile(join(skills, 'weekly-report', 'examples', 'sample.txt'), 'example');
  return { root, skills };
}

test('scans skill metadata and deterministic content hash', async () => {
  const { root, skills } = await fixture();
  const items = await scanSkills({ roots: [{ root: skills, scope: 'project', tool: 'agents' }] });
  assert.equal(items.length, 1);
  assert.equal(items[0].name, 'Weekly Report');
  assert.equal(items[0].description, 'Generate a weekly report');
  assert.deepEqual(items[0].files, ['examples/sample.txt', 'SKILL.md']);
  assert.match(items[0].sha256, /^[0-9a-f]{64}$/);
  void root;
});

test('does not follow symlinks outside the scan root', async () => {
  const { root, skills } = await fixture();
  const outside = join(root, 'outside');
  await mkdir(outside);
  await writeFile(join(outside, 'SKILL.md'), '# secret');
  await symlink(outside, join(skills, 'escaped'));
  const items = await scanSkills({ roots: [{ root: skills, scope: 'project', tool: 'agents' }] });
  assert.equal(items.some((item) => item.path.endsWith('escaped')), false);
});

test('discovers ancestor project roots and supports agent filters', async () => {
  const { root, skills } = await fixture();
  const nested = join(root, 'packages', 'app');
  const roots = (await import('./scanner.mjs')).discoverRoots({ cwd: nested, home: join(root, 'home'), scope: 'project', agents: ['generic'] });
  assert.equal(roots.some((item) => item.root === skills), true);
  assert.equal(roots.find((item) => item.root === skills)?.scope, 'project');
  assert.equal(roots.every((item) => item.tool === 'agents'), true);
});

test('uses platform-specific OpenCode user roots without changing the shared scan contract', async () => {
  const { discoverRoots } = await import('./scanner.mjs');
  const windowsRoots = discoverRoots({ home: '/Users/tester', cwd: '/workspace/app', platform: 'win32', scope: 'user', agents: ['opencode'] });
  assert.equal(windowsRoots.some((item) => item.root.endsWith('/AppData/Roaming/opencode/skills')), true);
  assert.equal(windowsRoots.every((item) => item.scope === 'user' && item.tool === 'opencode'), true);
});

test('packageSkill creates a zip without executing package files', async () => {
  const { root, skills } = await fixture();
  const { packageSkill } = await import('./scanner.mjs');
  const result = await packageSkill(join(skills, 'weekly-report'));
  assert.equal(result.filename, 'Weekly-Report.zip');
  assert.deepEqual([...result.buffer.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  void root;
});
