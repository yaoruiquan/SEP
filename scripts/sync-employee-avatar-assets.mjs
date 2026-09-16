import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const directory = new URL('web/public/assets/employees/silicon/', root);
const target = new URL('backend/src/common/employee-avatar-assets.json', root);
const prefix = '/assets/employees/silicon/';
const files = (await readdir(directory)).sort();
const assets = {};
for (const file of files.filter((name) => name.endsWith('.webp') && !/-(face|full)\.webp$/.test(name))) {
  const slug = file.slice(0, -5);
  const face = `${slug}-face.webp`;
  if (!files.includes(face)) throw new Error(`Missing face variant: ${face}`);
  const portraitBytes = await readFile(new URL(file, directory));
  const faceBytes = await readFile(new URL(face, directory));
  const version = createHash('sha256').update(portraitBytes).update(faceBytes).digest('hex').slice(0, 16);
  assets[prefix + file] = {
    id: `silicon:${slug}`,
    version,
    portraitPath: prefix + file,
    facePath: prefix + face,
  };
}
const output = `${JSON.stringify(assets, null, 2)}\n`;
if (process.argv.includes('--check')) {
  if (await readFile(target, 'utf8') !== output) {
    throw new Error('Avatar registry is stale. Run pnpm assets:sync and commit the registry with the images.');
  }
} else {
  await writeFile(target, output);
}
console.log(`Verified ${Object.keys(assets).length} employee avatars: ${fileURLToPath(target)}`);
