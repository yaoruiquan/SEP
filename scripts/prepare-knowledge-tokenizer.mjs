import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const revision = '5617a9f61b028005a4858fdac845db406aefb181';
const files = {
  'tokenizer.json': '21106b6d7dab2952c1d496fb21d5dc9db75c28ed361a05f5020bbba27810dd08',
  'tokenizer_config.json': 'a62b2b6784f990259fddef5f16388693a8043be4f69179e6a5257eeb3f9abac4',
};
const args = process.argv.slice(2);
let root = resolve(dirname(fileURLToPath(import.meta.url)), '../.cache/tokenizers');
let check = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--check') check = true;
  else if (args[i] === '--root' && args[i + 1] && !args[i + 1].startsWith('--')) root = resolve(args[++i]);
  else throw new Error('Usage: node scripts/prepare-knowledge-tokenizer.mjs [--root DIRECTORY] [--check]');
}
const directory = join(root, 'bge-m3', revision);
const hash = data => createHash('sha256').update(data).digest('hex');
if (!check) await mkdir(directory, { recursive: true });
for (const [name, expected] of Object.entries(files)) {
  const target = join(directory, name);
  let data;
  try { data = await readFile(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!data || hash(data) !== expected) {
    if (check) throw new Error(`Tokenizer missing or checksum mismatch: ${name}`);
    const response = await fetch(`https://huggingface.co/BAAI/bge-m3/resolve/${revision}/${name}`, {
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`Tokenizer download failed: ${name}, HTTP ${response.status}`);
    data = Buffer.from(await response.arrayBuffer());
    if (hash(data) !== expected) throw new Error(`Downloaded tokenizer checksum mismatch: ${name}`);
    JSON.parse(data.toString('utf8'));
    const temporary = `${target}.${process.pid}.download`;
    try {
      await writeFile(temporary, data, { flag: 'wx', mode: 0o644 });
      await rename(temporary, target);
    } finally { await rm(temporary, { force: true }); }
  }
  JSON.parse(data.toString('utf8'));
  console.log(JSON.stringify({ file: name, bytes: data.length, sha256: expected, status: 'verified' }));
}
console.log(JSON.stringify({ tokenizer: `BAAI/bge-m3@${revision}`, directory }));
