async (page) => {
  const capability = { id: 'cmszr2p2s000c7qr55rxb284f', name: 'UI Designer', description: '验收技能正文' };
  const member = { id: 'member-1', name: '原修改成员' };
  const admin = { id: 'admin-1', name: '企业审核管理员' };
  const published = { id: 'enterprise-published', version: '1.0.2', isEnterpriseCurrent: true };
  const base = {
    capability, capabilityId: capability.id, enterpriseId: 'enterprise-1',
    enterprise: { id: 'enterprise-1', name: '常州数易网络科技有限公司' },
    ownerId: member.id, owner: member, createdBy: member, version: '1.0.1',
    parentVersionId: null, sourceVersionId: null,
    content: '# UI Designer\n\n验收正文，原始个人提交与企业发布版独立保留。',
    changeSummary: '调整界面布局', status: 'ENTERPRISE_APPROVED',
    createdAt: '2026-10-10T02:40:00.000Z', updatedAt: '2026-10-10T02:40:00.000Z',
    enterpriseReviewStatus: 'APPROVED', platformProcessingStatus: 'NOT_SUBMITTED',
    originalSubmitters: [member], enterprisePublisher: admin,
    enterprisePublishedVersions: [published], isEnterpriseCurrent: false,
  };
  const rows = [
    { ...base, id: 'personal-approved', scope: 'PERSONAL' },
    { ...base, id: published.id, scope: 'ENTERPRISE', version: published.version,
      createdBy: admin, owner: null, ownerId: null, isEnterpriseCurrent: true,
      originalSubmitters: [member, { id: 'member-2', name: '共同提交成员' }] },
    { ...base, id: 'platform-version', scope: 'PLATFORM', status: 'PLATFORM_APPROVED',
      sourceVersionId: published.id, sourceVersion: { ...base, id: published.id, scope: 'ENTERPRISE' },
      platformProcessingStatus: 'APPROVED', isPlatformLatest: true, isMarketPublic: true,
      createdBy: { id: 'platform-admin', name: '平台运营人员' } },
    { ...base, id: 'personal-legacy', scope: 'PERSONAL', enterprisePublishedVersions: [] },
  ];
  page.__skillVersions = { requests: [], errors: [] };
  page.on('pageerror', (error) => page.__skillVersions.errors.push(error.message));
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/, '');
    page.__skillVersions.requests.push({ path, query: Object.fromEntries(url.searchParams) });
    let data;
    if (path === '/auth/refresh') data = {
      token: 'isolated-skill-version-fixture',
      user: { id: 'platform-admin', email: 'review@example.test', name: '平台运营人员', avatar: null, role: 'ADMIN' },
      enterprise: null, roleInEnterprise: null,
    };
    else if (path === '/admin/skill-versions') {
      const scope = url.searchParams.get('scope');
      const items = rows.filter((row) => !scope || row.scope === scope);
      data = { items, total: items.length, page: 1, limit: 20 };
    } else if (path.startsWith('/admin/skill-versions/')) {
      data = rows.find((row) => row.id === path.split('/').at(-1));
    } else if (path === '/notifications/unread-count') data = { count: 0 };
    else if (path === '/notifications') data = { items: [], total: 0 };
    else if (path === '/announcements/active') data = [];
    else data = {};
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('http://localhost:3000/admin/skills');
  await page.getByRole('heading', { name: '技能监控' }).waitFor();
  await page.getByRole('row', { name: /personal-approved/ }).waitFor();
}
