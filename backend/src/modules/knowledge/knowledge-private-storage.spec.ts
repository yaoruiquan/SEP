import { mkdtemp, rm, utimes, access, writeFile, readdir } from 'fs/promises';
import fs = require('fs/promises');
import { tmpdir } from 'os';
import { join } from 'path';
import { KnowledgePrivateStorage } from './knowledge-private-storage';

describe('knowledge private original recovery', () => {
  let root: string;
  let previous: string | undefined;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'kb-storage-test-'));
    previous = process.env.KNOWLEDGE_PRIVATE_PATH;
    process.env.KNOWLEDGE_PRIVATE_PATH = root;
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    if (previous === undefined) delete process.env.KNOWLEDGE_PRIVATE_PATH;
    else process.env.KNOWLEDGE_PRIVATE_PATH = previous;
    await rm(root, { recursive: true, force: true });
  });

  it.each(['write', 'file sync', 'directory sync'])('removes incomplete originals after %s fails', async stage => {
    const storage = new KnowledgePrivateStorage();
    const open = fs.open;
    const failure = new Error(`${stage} failed`);
    jest.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const handle = await open(...args);
      if (stage === 'write' && args[1] === 'wx') {
        const write = handle.writeFile.bind(handle);
        jest.spyOn(handle, 'writeFile').mockImplementation(async () => {
          await write(Buffer.from('partial'));
          throw failure;
        });
      } else if ((stage === 'file sync' && args[1] === 'wx') || (stage === 'directory sync' && args[1] === 'r')) {
        jest.spyOn(handle, 'sync').mockRejectedValueOnce(failure);
      }
      return handle;
    });
    await expect(storage.write(Buffer.from('original'))).rejects.toBe(failure);
    expect(await readdir(root)).toEqual([]);
  });

  it('removes legacy uploads outside the private root and tolerates already removed originals', async () => {
    const legacyRoot = await mkdtemp(join(tmpdir(), 'kb-legacy-uploads-'));
    const legacyPath = join(legacyRoot, 'old-document.txt');
    try {
      await writeFile(legacyPath, 'legacy original');
      const storage = new KnowledgePrivateStorage();
      await storage.remove(legacyPath);
      await expect(access(legacyPath)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(storage.remove(legacyPath)).resolves.toBeUndefined();
    } finally { await rm(legacyRoot, { recursive: true, force: true }); }
  });

  it('only removes aged, unreferenced UUID originals, preserving recent and referenced files', async () => {
    const storage = new KnowledgePrivateStorage();
    const orphan = await storage.write(Buffer.from('orphan'));
    const referenced = await storage.write(Buffer.from('referenced'));
    const recent = await storage.write(Buffer.from('in-flight transaction'));
    const unrelated = join(root, 'operator-notes.txt');
    await writeFile(unrelated, 'not an original');
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    for (const file of [orphan, referenced, unrelated]) await utimes(file, old, old);
    expect(await storage.sweepUnreferenced(async file => file === referenced)).toBe(1);
    await expect(access(orphan)).rejects.toThrow();
    for (const file of [referenced, recent, unrelated]) await expect(access(file)).resolves.toBeUndefined();
  });

  it('does not remove anything if the database reference check fails', async () => {
    const storage = new KnowledgePrivateStorage();
    const original = await storage.write(Buffer.from('data'));
    const old = new Date(0);
    await utimes(original, old, old);
    await expect(storage.sweepUnreferenced(async () => { throw new Error('DB offline'); })).rejects.toThrow('DB offline');
    await expect(access(original)).resolves.toBeUndefined();
  });
});
