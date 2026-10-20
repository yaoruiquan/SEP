/**
 * Offline browser fixture; every /api request is intercepted (never falls through).
 * Run: node scripts/e2e-video-v1-web.mjs
 * Options: VIDEO_WEB_BASE_URL=http://localhost:3000 VIDEO_WEB_OUTPUT=/tmp/video-review
 * Import: await installVideoV1Fixture(page, { scope: 'platform'|'enterprise',
 *   role: 'admin'|'member'|'manager', state: 'ready'|'empty'|'error'|'loading',
 *   imageState: 'ready'|'error', canEdit: true, conflict: false, delayMs: 0 });
 * Routes: /admin/settings/media-models and /settings/media.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const require = createRequire(new URL('../web/package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');
const { profile: originalProfile } = require('../backend/src/shared/fixtures/media-video-v1.json');
const checkedAt = '2026-10-19T03:00:00.000Z';
export const videoProfile = { ...originalProfile, profileId: 'mock-video-v1', modelId: 'mock-video-v1', displayName: '商品视频 Mock', configVersion: 'video-v1', enabled: false, verified: false };
export const videoPolicy = {
  enabledProfileIds: ['mock-video-ready', 'removed-video'], defaultProfileId: 'removed-video',
  allowedOperations: ['image-to-video'], maxDurationSeconds: 5, allowedAspectRatios: ['9:16'],
  maxResolution: '720p', maxConcurrentJobs: 1, periodBudget: 0,
};
const imageProfile = {
  profileId: 'image-basic', kind: 'image', displayName: '商品图片配置', modelId: 'offline-image', configVersion: 'image-v1',
  operations: ['generate'], executionMode: 'sync-response',
  capabilities: { supportsReferenceImage: false, maxOutputs: 1, sizes: ['1024x1024'] }, enabled: true, verified: true,
};

export async function installVideoV1Fixture(page, options = {}) {
  const scope = options.scope ?? 'platform';
  const role = options.role ?? 'admin';
  const state = options.state ?? 'ready';
  const canEdit = options.canEdit ?? role === 'admin';
  const requests = [];
  let version = 1;
  let profiles = state === 'empty' ? [] : [
    structuredClone(videoProfile),
    { ...structuredClone(videoProfile), profileId: 'mock-video-ready', displayName: '已校验商品视频', enabled: true, verified: true },
    { ...structuredClone(videoProfile), profileId: 'real-video', modelId: 'real-video-unadapted', displayName: '真实视频模型（未适配）' },
  ];
  let policy = state === 'empty' ? { ...videoPolicy, enabledProfileIds: [], defaultProfileId: null } : structuredClone(videoPolicy);
  const config = () => ({ policy, configured: state !== 'empty', canEdit, mock: true, executionTested: false });
  await page.routeWebSocket(/\/ws\//, (socket) => { socket.onMessage(() => {}); });
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const method = request.method();
    const body = method === 'POST' || method === 'PUT' || method === 'PATCH' ? request.postDataJSON() : undefined;
    requests.push({ path: pathname, method, body });
    const send = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'Cache-Control': 'no-store' }, body: JSON.stringify(data) });
    const fail = (message, status = 400) => send({ message }, status);
    if (pathname === '/api/auth/refresh') return send({ token: 'offline-video-fixture',
      user: { id: 'mock-video-user', email: 'video@example.invalid', name: scope === 'platform' ? '平台管理员' : '企业视频管理员', avatar: null, role: scope === 'platform' ? 'ADMIN' : 'USER' },
      enterprise: scope === 'platform' ? null : { id: 'video-enterprise', name: '视频验收企业' },
      roleInEnterprise: scope === 'platform' ? null : role === 'member' ? 'MEMBER' : role === 'manager' ? 'DEPT_MANAGER' : 'ENTERPRISE_ADMIN' });
    const isVideo = pathname.startsWith('/api/admin/media/video/') || pathname.startsWith('/api/enterprise/media-config/video');
    if (isVideo && (state === 'loading' || options.delayMs)) await new Promise((resolve) => setTimeout(resolve, state === 'loading' ? 3000 : options.delayMs));
    if (isVideo && state === 'error') return fail('视频配置暂时不可用，请重试', 503);
    if (!isVideo && options.imageState === 'error' && pathname.includes('media')) return fail('图片配置暂时不可用', 503);
    if (pathname === '/api/admin/media/video/models/discover' && method === 'POST') {
      assert.deepEqual(body, {});
      return send({ checkedAt, mock: true, executionTested: false, models: [
        { modelId: 'mock-video-v1', displayName: videoProfile.displayName, compatible: true, reason: '离线 Mock，不调用真实模型，不计费', suggested: { operations: videoProfile.operations, executionMode: videoProfile.executionMode, capabilities: videoProfile.capabilities } },
        { modelId: 'real-video-unadapted', displayName: '真实视频模型（未适配）', compatible: false, reason: '仅可导入草稿，未适配不能启用', suggested: { operations: videoProfile.operations, executionMode: videoProfile.executionMode, capabilities: videoProfile.capabilities } },
      ] });
    }
    if (pathname === '/api/admin/media/video/profiles' && method === 'GET') return send(profiles);
    if (pathname === '/api/admin/media/video/profiles' && method === 'POST') {
      if (profiles.some((profile) => profile.profileId === body.profileId)) return fail('视频 Profile ID 已存在', 409);
      assert.equal(body.enabled, false);
      assert.ok(!('verified' in body) && !('configVersion' in body));
      const profile = { ...body, enabled: false, verified: false, configVersion: `video-v${++version}` };
      profiles.push(profile);
      return send(profile, 201);
    }
    const match = pathname.match(/^\/api\/admin\/media\/video\/profiles\/([^/]+)(\/verify)?$/);
    if (match && (method === 'PATCH' || match[2] && method === 'POST')) {
      const index = profiles.findIndex((profile) => profile.profileId === decodeURIComponent(match[1]));
      if (index < 0) return fail('视频配置不存在', 404);
      const profile = profiles[index];
      if (options.conflict || body.expectedConfigVersion !== profile.configVersion) return fail('视频配置已更新，请重新加载', 409);
      if ((body.enabled || match[2]) && profile.modelId !== 'mock-video-v1') return fail('真实视频模型未适配，不可启用');
      if (body.enabled && !profile.verified) return fail('请先校验 Mock 视频配置');
      const { expectedConfigVersion: _expected, ...changes } = body;
      const contractChanged = ['modelId', 'operations', 'executionMode', 'capabilities'].some((key) => key in changes && JSON.stringify(changes[key]) !== JSON.stringify(profile[key]));
      profiles[index] = { ...profile, ...changes, ...(contractChanged ? { enabled: false, verified: false } : {}), ...(match[2] ? { verified: true } : {}), configVersion: `video-v${++version}` };
      return send(match[2] ? { profile: profiles[index], checkedAt, mock: true, executionTested: false } : profiles[index]);
    }
    if (pathname === '/api/enterprise/media-config/video/available-profiles' && method === 'GET') return send(profiles.filter((profile) => profile.enabled && profile.verified && profile.modelId === 'mock-video-v1').map(({ modelId: _model, ...profile }) => profile));
    if (pathname === '/api/enterprise/media-config/video') {
      if (method === 'PUT') {
        if (role !== 'admin' || !canEdit) return fail('视频授权只允许企业管理员修改', 403);
        if (body.defaultProfileId && !body.enabledProfileIds.includes(body.defaultProfileId)) return fail('默认视频 Profile 必须包含在允许列表');
        policy = { ...policy, ...body };
      }
      return send(config());
    }
    if (isVideo) return fail('离线 fixture 未定义此视频请求', 501);
    if (pathname === '/api/admin/media/connection') return send({ baseUrl: 'https://relay.example.invalid/v1', configured: true, apiKeyConfigured: true });
    if (pathname === '/api/admin/media/profiles') return send([imageProfile]);
    if (pathname === '/api/enterprise/media-config') return send({ policy: { enabledProfileIds: ['image-basic'], defaultProfileId: 'image-basic', allowedOperations: ['generate'], maxOutputs: 1, maxWidth: 4096, maxHeight: 4096 }, configured: true, canEdit });
    if (pathname === '/api/enterprise/media-config/available-profiles') { const { modelId: _model, ...profile } = imageProfile; return send([profile]); }
    if (pathname === '/api/enterprise/info') return send({ id: 'video-enterprise', name: '视频验收企业', metadata: { onboardingCompleted: true }, _count: { members: 3, departments: 1, subscriptions: 0 } });
    if (pathname.includes('notification')) return send({ items: [], total: 0, unreadCount: 0 });
    return send([]);
  });
  return { requests, getProfiles: () => structuredClone(profiles), getPolicy: () => structuredClone(policy) };
}

async function prepareMobileScreenshot(page, panel, scope) {
  await page.setViewportSize({ width: 375, height: 812 });
  if (scope === 'enterprise') {
    const toggle = page.getByRole('button', { name: 'Toggle menu', exact: true });
    const sidebar = page.locator('aside').filter({ has: page.getByRole('button', { name: /^(展开|折叠)侧边栏$/, includeHidden: true }) });
    await expect(toggle).toBeVisible();
    if (await sidebar.evaluate((element) => element.classList.contains('translate-x-0'))) await toggle.click();
    // Resizing from desktop animates the closed sidebar out of the viewport.
    await expect.poll(async () => sidebar.evaluate((element) => element.getBoundingClientRect().right)).toBeLessThanOrEqual(1);
  } else {
    const navigation = page.getByRole('dialog', { name: '管理后台导航', exact: true });
    if (await navigation.isVisible()) await navigation.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(navigation).toBeHidden();
    await expect(page.getByRole('button', { name: '打开导航菜单', exact: true })).toBeVisible();
  }
  await panel.evaluate((element) => {
    element.scrollIntoView({ block: 'start' });
    // Leave room for the existing fixed mobile navigation and sticky topbar.
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      if (parent.scrollTop > 0) { parent.scrollTop = Math.max(0, parent.scrollTop - 80); break; }
    }
  });
  const inspect = () => panel.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const targets = [...element.querySelectorAll('h2, h3, label, p')].filter((target) => {
      const box = target.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && box.left >= 0 && box.right <= innerWidth && box.top >= 72 && box.bottom <= innerHeight - 80;
    });
    const blockedTargets = targets.filter((target) => {
      const box = target.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return !hit || !target.contains(hit);
    }).map((target) => target.textContent.trim());
    return {
      panelLeft: rect.left, panelRight: rect.right, viewportWidth: innerWidth,
      overflow: element.scrollWidth > element.clientWidth,
      checkedTargets: targets.length, blockedTargets,
    };
  });
  await expect.poll(async () => (await inspect()).blockedTargets).toEqual([]);
  const result = await inspect();
  assert.ok(result.panelLeft >= 0 && result.panelRight <= result.viewportWidth, 'Mobile video panel must fit in the viewport');
  assert.ok(result.checkedTargets > 0, 'Mobile video content must be visible for occlusion checks');
  assert.equal(result.overflow, false, 'Mobile video panel overflow');
  return result;
}

async function main() {
  const baseURL = process.env.VIDEO_WEB_BASE_URL || 'http://localhost:3000';
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseURL).hostname), 'Use a local development server');
  const output = path.resolve(process.env.VIDEO_WEB_OUTPUT || 'outputs/video-v1-web');
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const options of [
      { scope: 'platform', state: 'ready' }, { scope: 'enterprise', state: 'ready' },
      { scope: 'enterprise', role: 'member', state: 'ready' },
      { scope: 'platform', state: 'empty' }, { scope: 'enterprise', state: 'error' },
      { scope: 'enterprise', state: 'ready', imageState: 'error' },
      { scope: 'platform', state: 'error' }, { scope: 'enterprise', state: 'empty' },
      { scope: 'platform', state: 'loading' }, { scope: 'enterprise', state: 'loading' },
    ]) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
      const page = await context.newPage();
      const fixture = await installVideoV1Fixture(page, options);
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`${baseURL}${options.scope === 'platform' ? '/admin/settings/media-models' : '/settings/media'}`);
      const panel = page.getByRole('region', { name: options.scope === 'platform' ? '视频模型配置' : '视频授权', exact: true });
      await panel.waitFor();
      if (options.state === 'loading') await panel.getByRole('status').waitFor();
      else if (options.state === 'error') await panel.getByRole('alert').waitFor();
      else if (options.scope === 'platform') await panel.getByRole('button', { name: '发现视频模型' }).waitFor({ state: 'visible' });
      else await panel.getByRole('form', { name: '视频授权策略' }).waitFor();
      if (options.scope === 'platform' && options.state === 'ready') {
        await panel.getByRole('button', { name: '校验视频 商品视频 Mock' }).click();
        const enable = panel.getByRole('switch', { name: '启用视频 商品视频 Mock' });
        await Promise.all([
          page.waitForResponse((response) => response.url().endsWith('/admin/media/video/profiles/mock-video-v1') && response.request().method() === 'PATCH'),
          enable.click(),
        ]);
        assert.equal(fixture.getProfiles()[0].enabled, true);
        await panel.getByRole('button', { name: '发现视频模型' }).click();
        await panel.getByRole('button', { name: '导入视频模型 商品视频 Mock' }).waitFor();
        await panel.getByRole('button', { name: '导入视频模型 商品视频 Mock' }).click();
        const dialog = page.getByRole('dialog');
        await dialog.getByLabel('视频 Profile ID').fill('mock-video-imported');
        await Promise.all([
          page.waitForResponse((response) => response.url().endsWith('/admin/media/video/profiles') && response.request().method() === 'POST'),
          dialog.getByRole('button', { name: '保存视频配置' }).click(),
        ]);
        await dialog.waitFor({ state: 'hidden' });
        assert.equal(fixture.getProfiles().find((profile) => profile.profileId === 'mock-video-imported').enabled, false);
      }
      if (options.scope === 'enterprise' && options.role !== 'member' && options.state === 'ready') {
        await panel.getByRole('checkbox', { name: /removed-video/ }).click();
        await panel.getByRole('checkbox', { name: /removed-video/ }).waitFor({ state: 'detached' });
        await Promise.all([
          page.waitForResponse((response) => response.url().endsWith('/enterprise/media-config/video') && response.request().method() === 'PUT'),
          panel.getByRole('button', { name: '保存视频策略' }).click(),
        ]);
        assert.equal(fixture.getPolicy().defaultProfileId, null);
      }
      if (options.role === 'member') assert.equal(await panel.getByRole('button', { name: '保存视频策略' }).count(), 0);
      const dismiss = page.getByRole('alert').getByRole('button', { name: '关闭', exact: true });
      for (let i = 0; i < 3 && await dismiss.count(); i++) await dismiss.first().click();
      const name = [options.scope, options.role ?? 'admin', options.state, options.imageState ?? 'image-ready'].join('-');
      await panel.evaluate((element) => element.scrollIntoView({ block: 'start' }));
      await page.screenshot({ path: path.join(output, `${name}.png`) });
      const mobileContent = await prepareMobileScreenshot(page, panel, options.scope);
      await page.screenshot({ path: path.join(output, `${name}-mobile.png`) });
      assert.deepEqual(errors, [], `${name}: runtime errors`);
      results.push({ ...options, requests: fixture.requests, mobileOverflow: mobileContent.overflow, mobileContent, errors });
      await context.close();
    }
    await writeFile(path.join(output, 'report.json'), JSON.stringify(results, null, 2));
    console.log(`Video V1 browser fixtures passed: ${results.length} scopes, desktop/mobile screenshots in ${output}`);
  } finally { await browser.close(); }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
