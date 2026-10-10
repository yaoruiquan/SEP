async (page) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const capability = { id: 'review-fix-skill', name: '技能发布回归检查', description: '历史发布版本与提交审核' };
  const user = { id: 'review-admin', name: '企业管理员', email: 'review@example.test', role: 'USER', avatar: null };
  const release = (id, scope, createdAt, publishedAt) => ({
    id, capabilityId: capability.id, scope, version: '1.0.0', changeSummary: id,
    status: scope === 'PLATFORM' ? 'PLATFORM_APPROVED' : 'ENTERPRISE_APPROVED',
    createdAt, updatedAt: publishedAt ?? createdAt,
    platformReviewedAt: scope === 'PLATFORM' ? publishedAt : null,
    enterpriseReviewedAt: scope === 'ENTERPRISE' ? publishedAt : null,
    createdBy: user, enterpriseReviewedBy: null, reviews: [], sourceSubmissionId: null,
    isCurrent: id === 'current-enterprise', content: '# Skill\n\nReview fixture.', capability,
    parentVersionId: null, sourceVersionId: null,
  });
  const releases = [
    release('late-platform', 'PLATFORM', '2026-10-01T00:00:00Z', '2026-10-10T01:00:00Z'),
    release('older-platform', 'PLATFORM', '2026-10-08T00:00:00Z', '2026-10-08T01:00:00Z'),
    release('current-enterprise', 'ENTERPRISE', '2026-10-09T00:00:00Z', '2026-10-09T01:00:00Z'),
    release('legacy-platform', 'PLATFORM', '2026-10-02T00:00:00Z', null),
  ];
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data;
    if (path === '/api/auth/refresh') data = { token: 'mock-review-token', user, enterprise: { id: 'review-enterprise', name: '示例企业' }, roleInEnterprise: 'ENTERPRISE_ADMIN' };
    else if (path.endsWith('/versions')) data = { capability, canManage: true, versions: releases,
      currentVersionId: 'current-enterprise', selectedAt: '2026-10-09T01:00:00Z',
      effectiveVersionState: 'EXPLICIT', pendingTotal: 0, subscriptions: [], myPersonalVersionId: null };
    else if (path.endsWith('/preview')) data = releases.find((value) => path.includes(`/${value.id}/`));
    else if (path === '/api/enterprise') data = { id: 'review-enterprise', name: '示例企业', logo: null };
    else if (path.includes('unread-count')) data = { count: 0 };
    else if (path.includes('announcements')) data = [];
    else if (path.includes('cart')) data = { items: [], totalAmount: 0, totalItems: 0 };
    else data = { items: [], total: 0 };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('http://localhost:3000/capabilities/review-fix-skill?tab=versions');
  await page.getByRole('heading', { name: capability.name, exact: true }).waitFor();
  const expected = ['current-enterprise', 'late-platform', 'older-platform', 'legacy-platform'];
  const actual = await page.locator('[data-release-id]').evaluateAll((rows) => rows.map((row) => row.dataset.releaseId));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Unexpected order: ${actual}`);
  const late = page.locator('[data-release-id="late-platform"]');
  if (!await late.getByText('发布时间', { exact: true }).count()) throw new Error('Missing platform publication label');
  const displayedTime = await late.locator('time').textContent();
  const legacy = page.locator('[data-release-id="legacy-platform"]');
  if (!await legacy.getByText('创建时间', { exact: true }).count()) throw new Error('Missing legacy creation label');
  const bounds = async () => {
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Horizontal overflow');
  };
  await bounds();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'output/playwright/skill-review-fixes-desktop.png', fullPage: true });
  await late.getByRole('button', { name: '查看详情' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText(`发布时间：${displayedTime}`, { exact: true }).waitFor();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'output/playwright/skill-review-fixes-detail.png' });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await bounds();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'output/playwright/skill-review-fixes-mobile.png', fullPage: true });
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(JSON.stringify({ order: actual, displayedTime, legacyLabel: '创建时间', desktop: 'passed', mobile: 'passed', pageErrors: errors }));
}
