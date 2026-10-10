async (page) => {
  const errors = [];
  const onPageError = (error) => errors.push(error.message);
  page.on('pageerror', onPageError);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => localStorage.setItem('theme', 'light'));
  const capability = { id: 'visual-skill', name: '多平台经营协同', description: '统一淘宝、天猫、京东、拼多多等平台的日常经营任务。' };
  const owner = { id: 'member', name: '刘凌', email: 'member@example.test' };
  const user = { id: 'admin', name: '企业管理员', email: 'admin@example.test', avatar: null, role: 'USER' };
  const release = (id, scope, version, summary) => ({
    id, capabilityId: capability.id, scope, version, changeSummary: summary,
    status: scope === 'PLATFORM' ? 'PLATFORM_APPROVED' : 'ENTERPRISE_APPROVED',
    createdAt: '2026-10-08T03:31:00Z', updatedAt: '2026-10-10T05:22:00Z',
    enterpriseReviewedAt: scope === 'ENTERPRISE' ? '2026-10-10T05:22:00Z' : null,
    createdBy: user, reviews: [], sourceSubmissionId: scope === 'ENTERPRISE' ? 'approved' : null,
    isCurrent: scope === 'ENTERPRISE', content: '# 多平台经营协同\n\n统一各平台经营任务。\n检查商品库存并生成经营报告。',
    capability, parentVersionId: scope === 'ENTERPRISE' ? 'platform' : null, sourceVersionId: null,
  });
  const releases = [release('enterprise', 'ENTERPRISE', '1.0.0', '新增日常库存检查与经营报告'), release('platform', 'PLATFORM', '1.0.0', '初始版本')];
  const baseline = { id: 'enterprise', scope: 'ENTERPRISE', version: '1.0.0', content: releases[0].content };
  const submission = (id, approved) => ({
    id, owner, basedOn: { id: 'platform', scope: 'PLATFORM', version: '1.0.0' },
    changeSummary: approved ? '新增日常库存检查与经营报告' : '完善跨平台库存异常处理和长名称商品的经营分析流程\n补充库存异常的通知与处理要求。',
    version: `0.0.0-personal.${'a'.repeat(64)}`, content: `${releases[1].content}\n新增库存异常通知。`,
    updatedAt: '2026-10-10T05:19:00Z', submittedAt: '2026-10-10T05:16:00Z', pending: !approved,
    status: approved ? 'ENTERPRISE_APPROVED' : 'PENDING_ENTERPRISE_REVIEW',
    reviewStatus: approved ? 'ENTERPRISE_APPROVED' : 'PENDING_ENTERPRISE_REVIEW',
    isWorkingCopy: false, isLegacyUnpublished: false, publishedVersionId: approved ? 'enterprise' : null,
    publishedVersion: approved ? { id: 'enterprise', scope: 'ENTERPRISE', version: '1.0.0', isCurrent: true } : null,
  });
  const items = [submission('pending', false), submission('approved', true)];
  let role = 'ENTERPRISE_ADMIN';
  await page.unroute('**/api/**');
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data;
    if (path === '/api/auth/refresh') data = { token: 'visual-only-token', user: role === 'MEMBER' ? { ...user, id: 'member', name: owner.name } : user, enterprise: { id: 'visual-enterprise', name: '示例科技' }, roleInEnterprise: role };
    else if (path.endsWith('/versions')) data = { capability, canManage: role === 'ENTERPRISE_ADMIN', versions: releases, currentVersionId: 'enterprise', effectiveVersion: baseline, effectiveVersionState: 'EXPLICIT', selectedAt: '2026-10-10T05:22:00Z', pendingTotal: 1, subscriptions: [], myPersonalVersionId: null };
    else if (path.endsWith('/personal-diffs')) data = { canManage: role === 'ENTERPRISE_ADMIN', items, total: 2, page: 1, limit: 20, baseline };
    else if (path.includes('/submissions/')) {
      const item = items.find((value) => path.endsWith(`/${value.id}`));
      data = { canManage: role === 'ENTERPRISE_ADMIN', item, source: { id: 'platform', scope: 'PLATFORM', version: '1.0.0', content: releases[1].content }, sourceState: 'AVAILABLE', currentBaseline: baseline, currentBaselineState: 'EXPLICIT', reviews: item.pending ? [] : [{ id: 'review', actorType: 'ENTERPRISE', decision: 'APPROVE', comment: '确认库存检查流程与权限边界。', reviewer: user, createdAt: '2026-10-10T05:22:00Z', versionId: item.id, version: item.version }] };
    } else if (path.endsWith('/preview')) data = releases.find((value) => path.includes(`/${value.id}/`));
    else if (path === '/api/enterprise') data = { id: 'visual-enterprise', name: '示例科技', logo: null };
    else if (path.includes('unread-count')) data = { count: 0 };
    else if (path.includes('announcements')) data = [];
    else if (path.includes('cart')) data = { items: [], totalAmount: 0, totalItems: 0 };
    else data = { items: [], total: 0 };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
  const output = 'output/playwright';
  const screenshot = async (options) => {
    // Framer Motion opacity transitions may still be active when an element is visible.
    await page.waitForTimeout(500);
    await page.screenshot(options);
  };
  const checkBounds = async () => {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    if (overflow) throw new Error('Page has horizontal overflow');
    const dialog = page.getByRole('dialog');
    if (await dialog.count()) {
      const box = await dialog.boundingBox();
      const viewport = page.viewportSize();
      if (!box || box.x < 0 || box.y < 0 || box.x + box.width > viewport.width + 1 || box.y + box.height > viewport.height + 1) throw new Error('Dialog exceeds viewport');
    }
  };
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('http://localhost:3000/capabilities/visual-skill?tab=versions');
  await page.getByRole('heading', { name: capability.name, exact: true }).waitFor();
  await screenshot({ path: `${output}/skill-v3-desktop-releases.png`, fullPage: true });
  await page.getByRole('button', { name: '启用', exact: true }).click();
  await page.getByRole('button', { name: '确认启用', exact: true }).waitFor();
  await checkBounds();
  await screenshot({ path: `${output}/skill-v3-desktop-enable-confirmation.png` });
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '查看详情' }).first().click();
  await page.getByRole('dialog').getByRole('link', { name: '来源提交' }).waitFor();
  await checkBounds();
  await screenshot({ path: `${output}/skill-v3-desktop-release-detail.png` });
  await page.getByRole('dialog').getByRole('link', { name: '来源提交' }).click();
  await page.getByRole('dialog').getByRole('tab', { name: '处理记录' }).click();
  await page.getByText('确认库存检查流程与权限边界。').waitFor();
  await screenshot({ path: `${output}/skill-v3-desktop-history.png` });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '审核', exact: true }).click();
  await page.getByRole('combobox', { name: '对比对象' }).waitFor();
  await checkBounds();
  await screenshot({ path: `${output}/skill-v3-desktop-review.png` });
  await page.getByRole('button', { name: '通过并启用', exact: true }).click();
  await page.getByRole('button', { name: '确认通过并启用' }).waitFor();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await checkBounds();
  await screenshot({ path: `${output}/skill-v3-mobile-submissions.png`, fullPage: true });
  await page.getByRole('button', { name: '审核', exact: true }).click();
  await checkBounds();
  await screenshot({ path: `${output}/skill-v3-mobile-review.png` });
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: '发布版本', exact: true }).click();
  await checkBounds();
  await screenshot({ path: `${output}/skill-v3-mobile-releases.png`, fullPage: true });
  await page.getByRole('button', { name: '查看详情' }).first().click();
  await page.getByRole('dialog').getByRole('link', { name: '来源提交' }).waitFor();
  await checkBounds();
  await screenshot({ path: `${output}/skill-v3-mobile-release-detail.png` });
  await page.keyboard.press('Escape');
  await page.goBack();
  await page.getByRole('dialog').waitFor();
  await page.goBack();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.goBack();
  await page.getByRole('button', { name: '审核', exact: true }).waitFor();
  role = 'MEMBER';
  await page.goto('http://localhost:3000/capabilities/visual-skill?tab=changes&submission=pending');
  await page.getByRole('dialog').getByRole('combobox', { name: '对比对象' }).waitFor();
  if (await page.getByRole('button', { name: '通过并启用', exact: true }).count()) throw new Error('Member sees review action');
  await checkBounds();
  await screenshot({ path: `${output}/skill-v3-mobile-member-detail.png` });
  role = 'ENTERPRISE_ADMIN';
  await page.evaluate(() => localStorage.setItem('theme', 'dark'));
  await page.goto('http://localhost:3000/capabilities/visual-skill?tab=changes&submission=pending');
  await page.getByRole('button', { name: '通过并启用', exact: true }).waitFor();
  await checkBounds();
  await screenshot({ path: `${output}/skill-v3-mobile-dark-review.png` });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('tab', { name: '发布版本', exact: true }).click();
  await checkBounds();
  await screenshot({ path: `${output}/skill-v3-desktop-dark-releases.png`, fullPage: true });
  await page.evaluate(() => { localStorage.setItem('theme', 'light'); window.dispatchEvent(new Event('storage')); });
  page.off('pageerror', onPageError);
  if (errors.length) throw new Error(errors.join('\n'));
  return 'PASS: desktop/mobile, light/dark, releases, source navigation, history, review and enable confirmation, back navigation, member read-only and viewport bounds';
}
