import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const MAX_VIDEO_BYTES = 256 * 1024 * 1024;
const MAX_JSON_BYTES = 256 * 1024;

function fail(code) { throw new Error(code); }

async function readBounded(response, limit) {
  if (!response.body) fail('VIDEO_EMPTY_RESPONSE');
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) fail('VIDEO_RESPONSE_TOO_LARGE');
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function probeVideo(path) {
  let data;
  try {
    const { stdout } = await run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', path], {
      timeout: 30_000, maxBuffer: MAX_JSON_BYTES,
    });
    data = JSON.parse(stdout);
  } catch { fail('VIDEO_PROBE_FAILED'); }
  const video = data.streams?.find(item => item.codec_type === 'video');
  const durationSeconds = Number(data.format?.duration);
  if (!video || !Number.isInteger(video.width) || video.width <= 0 || !Number.isInteger(video.height) || video.height <= 0 ||
      !Number.isFinite(durationSeconds) || durationSeconds <= 0 || !data.format?.format_name?.split(',').includes('mp4')) {
    fail('VIDEO_INVALID_MEDIA');
  }
  return { durationSeconds, width: video.width, height: video.height, codec: video.codec_name,
    frameRate: video.avg_frame_rate, hasAudio: data.streams.some(item => item.codec_type === 'audio') };
}

function apiRoot(baseUrl) {
  const url = new URL(baseUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) fail('VIDEO_INVALID_URL');
  const path = url.pathname.replace(/\/+$/, '');
  url.pathname = path.endsWith('/v1') ? path : `${path}/v1`;
  return url.href.replace(/\/$/, '');
}

/** Recover an existing task only. There is deliberately no task-creation path. */
export async function recoverVideoTask({ baseUrl, apiKey, taskId, model, outputDir, fetchImpl = fetch, probe = probeVideo,
  maxVideoBytes = MAX_VIDEO_BYTES }) {
  const root = apiRoot(baseUrl);
  if (typeof apiKey !== 'string' || !apiKey.trim() || /[\r\n]/.test(apiKey)) fail('VIDEO_MISSING_CREDENTIAL');
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(taskId ?? '')) fail('VIDEO_INVALID_TASK_ID');
  if (typeof model !== 'string' || !model) fail('VIDEO_MODEL_REQUIRED');
  if (!Number.isSafeInteger(maxVideoBytes) || maxVideoBytes < 12 || maxVideoBytes > MAX_VIDEO_BYTES) fail('VIDEO_INVALID_LIMIT');
  const dir = resolve(outputDir);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  // One writer per recovery directory. A crash leaves a lock rather than risking overwrites.
  const lockPath = join(dir, '.recovery.lock');
  const lock = await open(lockPath, 'wx', 0o600);
  const target = join(dir, 'video.mp4');
  const part = join(dir, 'video.mp4.part');
  const manifestPath = join(dir, 'recovery.json');
  try {
    let previous;
    try { previous = JSON.parse(await readFile(manifestPath, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') fail('VIDEO_RECOVERY_MANIFEST_INVALID'); }
    if (previous) {
      if (previous.taskId !== taskId || previous.model !== model || previous.origin !== new URL(root).origin) {
        fail('VIDEO_RECOVERY_CONFLICT');
      }
      const bytes = await readFile(target);
      if (bytes.length !== previous.byteLength || createHash('sha256').update(bytes).digest('hex') !== previous.sha256) {
        fail('VIDEO_SAVED_FILE_CORRUPT');
      }
      return { ...previous, filePath: target, recoveredFromDisk: true, media: await probe(target) };
    }
    const taskUrl = `${root}/videos/${taskId}`;
    const request = (url, accept) => fetchImpl(url, { method: 'GET', redirect: 'error',
      signal: AbortSignal.timeout(180_000), headers: { Authorization: `Bearer ${apiKey}`, Accept: accept } });
    const response = await request(taskUrl, 'application/json');
    if (!response.ok) { await response.body?.cancel(); fail('VIDEO_TASK_QUERY_FAILED'); }
    let task;
    try { task = JSON.parse((await readBounded(response, MAX_JSON_BYTES)).toString('utf8')); }
    catch { fail('VIDEO_TASK_RESPONSE_INVALID'); }
    if (task.id !== taskId || task.model !== model) fail('VIDEO_TASK_MISMATCH');
    if (task.status !== 'completed') fail('VIDEO_TASK_NOT_COMPLETED');
    const content = await request(`${taskUrl}/content`, 'video/mp4, application/octet-stream');
    if (!content.ok) { await content.body?.cancel(); fail('VIDEO_CONTENT_UNAVAILABLE'); }
    const mimeType = content.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (!['video/mp4', 'application/octet-stream'].includes(mimeType)) {
      await content.body?.cancel(); fail('VIDEO_CONTENT_TYPE_INVALID');
    }
    const declared = content.headers.get('content-length');
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxVideoBytes)) {
      await content.body?.cancel(); fail('VIDEO_RESPONSE_TOO_LARGE');
    }
    if (!content.body) fail('VIDEO_EMPTY_RESPONSE');
    const reader = content.body.getReader();
    const file = await open(part, 'wx', 0o600);
    const hash = createHash('sha256');
    let byteLength = 0;
    let signature = Buffer.alloc(0);
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        byteLength += value.byteLength;
        if (byteLength > maxVideoBytes) fail('VIDEO_RESPONSE_TOO_LARGE');
        const chunk = Buffer.from(value);
        hash.update(chunk);
        if (signature.length < 12) signature = Buffer.concat([signature, chunk.subarray(0, 12 - signature.length)]);
        await file.writeFile(chunk);
      }
      if (declared !== null && byteLength !== Number(declared)) fail('VIDEO_CONTENT_TRUNCATED');
      if (signature.length < 12 || signature.toString('ascii', 4, 8) !== 'ftyp') fail('VIDEO_INVALID_MP4');
      await file.sync();
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
      await file.close();
    }
    const media = await probe(part);
    const manifest = { checkedAt: new Date().toISOString(), mode: 'existing-task-recovery',
      origin: new URL(root).origin, taskId, model, upstreamStatus: task.status, byteLength,
      sha256: hash.digest('hex'), mimeType: 'video/mp4', media, executionPosts: 0, sepWalletWrites: 0,
      requestBillingVerified: false };
    // An interrupted download is retried from the same task, never by submitting again.
    await rename(part, target);
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    return { ...manifest, filePath: target, recoveredFromDisk: false };
  } finally {
    await unlink(part).catch(() => {});
    await lock.close();
    await unlink(lockPath);
  }
}

async function main() {
  if (!process.argv[2] || !process.argv[3]) fail('VIDEO_RECOVERY_ARGUMENTS_REQUIRED');
  const evidence = JSON.parse(await readFile(resolve(process.argv[2]), 'utf8'));
  const result = await recoverVideoTask({ baseUrl: process.env.VIDEO_PREFLIGHT_BASE_URL,
    apiKey: process.env.VIDEO_PREFLIGHT_API_KEY, taskId: evidence.response?.id,
    model: evidence.model, outputDir: process.argv[3] });
  console.log(JSON.stringify({ filePath: result.filePath, byteLength: result.byteLength,
    sha256: result.sha256, media: result.media, recoveredFromDisk: result.recoveredFromDisk, executionPosts: 0 }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(/^VIDEO_[A-Z_]+$/.test(error.message) ? error.message : 'VIDEO_RECOVERY_FAILED');
    process.exitCode = 1;
  });
}
