import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { recoverVideoTask } from './media-video-recover.mjs';

const bytes = Buffer.concat([Buffer.from([0, 0, 0, 20]), Buffer.from('ftypisom'), Buffer.alloc(40)]);
const media = { durationSeconds: 4.46, width: 1344, height: 768, frameRate: '24/1', hasAudio: true };
const task = { id: 'task_original', model: 'minimax-h3', status: 'completed' };
const input = { baseUrl: 'https://upstream.example', apiKey: 'private-test-key', taskId: task.id, model: task.model,
  probe: async () => media };
const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const video = (body = bytes, headers = {}) => new Response(body, { headers: {
  'content-type': 'video/mp4', 'content-length': String(body.length), ...headers,
} });

async function directory(t) {
  const path = await mkdtemp(join(tmpdir(), 'sep-video-recovery-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

test('recovers only the original task, saves verified MP4 and restores with no upstream call', async t => {
  const outputDir = await directory(t);
  const calls = [];
  const result = await recoverVideoTask({ ...input, outputDir, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return url.endsWith('/content') ? video() : json(task);
  } });
  assert.equal(result.executionPosts, 0);
  assert.equal(result.recoveredFromDisk, false);
  assert.equal(result.byteLength, bytes.length);
  assert.deepEqual(await readFile(result.filePath), bytes);
  assert.deepEqual(calls.map(c => c.url), ['https://upstream.example/v1/videos/task_original', 'https://upstream.example/v1/videos/task_original/content']);
  for (const { options } of calls) {
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, `Bearer ${input.apiKey}`);
  }
  const restored = await recoverVideoTask({ ...input, outputDir, fetchImpl: () => assert.fail('must use the saved file') });
  assert.equal(restored.recoveredFromDisk, true);
  assert.equal(restored.sha256, result.sha256);
  assert.doesNotMatch(await readFile(join(outputDir, 'recovery.json'), 'utf8'), /private-test-key/);
});

test('incomplete, failed, wrong task and wrong model never download or resubmit', async t => {
  for (const override of [{ status: 'queued' }, { status: 'failed' }, { id: 'task_other' }, { model: 'other-model' }]) {
    const outputDir = await directory(t);
    let calls = 0;
    await assert.rejects(recoverVideoTask({ ...input, outputDir, fetchImpl: async () => { calls++; return json({ ...task, ...override }); } }));
    assert.equal(calls, 1);
    await assert.rejects(readFile(join(outputDir, 'video.mp4')));
  }
});

test('rejects HTML/JSON masquerading as content, missing signature, oversized and truncated media', async t => {
  for (const response of [
    () => video(Buffer.from('<html>no video</html>'), { 'content-type': 'text/html' }),
    () => video(Buffer.from('{"error":"no video"}')),
    () => video(bytes, { 'content-length': String(bytes.length + 1) }),
    () => video(bytes, { 'content-length': '999999999999' }),
    () => video(bytes, { 'content-length': 'no' }),
  ]) {
    const outputDir = await directory(t);
    await assert.rejects(recoverVideoTask({ ...input, outputDir, fetchImpl: async url => url.endsWith('/content') ? response() : json(task) }));
    await assert.rejects(readFile(join(outputDir, 'video.mp4')));
    await assert.rejects(readFile(join(outputDir, 'video.mp4.part')));
    await assert.rejects(readFile(join(outputDir, 'recovery.json')));
  }
});

test('interrupted stream cleans partial file and a new process downloads the same task', async t => {
  const outputDir = await directory(t);
  let reads = 0;
  const broken = new ReadableStream({ pull(controller) {
    if (reads++ === 0) controller.enqueue(bytes.subarray(0, 20));
    else controller.error(new Error('network interrupted'));
  } });
  await assert.rejects(recoverVideoTask({ ...input, outputDir, fetchImpl: async url => url.endsWith('/content')
    ? new Response(broken, { headers: { 'content-type': 'video/mp4' } }) : json(task) }));
  await assert.rejects(readFile(join(outputDir, 'video.mp4.part')));
  const result = await recoverVideoTask({ ...input, outputDir, fetchImpl: async url => url.endsWith('/content') ? video() : json(task) });
  assert.equal(result.byteLength, bytes.length);
});

test('bounds chunked downloads without a declared content length and rejects invalid media probe', async t => {
  const outputDir = await directory(t);
  await assert.rejects(recoverVideoTask({ ...input, outputDir, maxVideoBytes: 20,
    fetchImpl: async url => url.endsWith('/content') ? new Response(bytes, { headers: { 'content-type': 'video/mp4' } }) : json(task) }),
  /VIDEO_RESPONSE_TOO_LARGE/);
  await assert.rejects(recoverVideoTask({ ...input, outputDir, probe: async () => { throw new Error('VIDEO_PROBE_FAILED'); },
    fetchImpl: async url => url.endsWith('/content') ? video() : json(task) }), /VIDEO_PROBE_FAILED/);
  await assert.rejects(readFile(join(outputDir, 'video.mp4')));
});

test('saved corruption or different task cannot masquerade as recovered success', async t => {
  const outputDir = await directory(t);
  await recoverVideoTask({ ...input, outputDir, fetchImpl: async url => url.endsWith('/content') ? video() : json(task) });
  await assert.rejects(recoverVideoTask({ ...input, outputDir, taskId: 'task_other', fetchImpl: () => assert.fail() }), /VIDEO_RECOVERY_CONFLICT/);
  await writeFile(join(outputDir, 'video.mp4'), 'corrupted');
  await assert.rejects(recoverVideoTask({ ...input, outputDir, fetchImpl: () => assert.fail() }), /VIDEO_SAVED_FILE_CORRUPT/);
});

test('invalid origin, credential or task id fails before network calls', async t => {
  const outputDir = await directory(t);
  for (const change of [{ baseUrl: 'http://upstream.example' }, { baseUrl: 'https://user:pass@upstream.example' },
    { baseUrl: 'https://upstream.example?secret=x' }, { apiKey: '' }, { apiKey: 'a\nb' }, { taskId: '../private' }]) {
    await assert.rejects(recoverVideoTask({ ...input, ...change, outputDir, fetchImpl: () => assert.fail() }));
  }
});
