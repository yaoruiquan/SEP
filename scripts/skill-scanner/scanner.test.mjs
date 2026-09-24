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
