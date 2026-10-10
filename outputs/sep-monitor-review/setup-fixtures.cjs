async (page) => {
  const fixtures = FIXTURES_PLACEHOLDER;
  const base = fixtures.clientTaskMonitorDetailFixture;
  const event = (sequence, type, data, extra = {}) => ({
    id: `proof-${sequence}`, clientRunId: 'run-1', participationId: 'participation-1', sequence,
    type, message: JSON.stringify(data), stepKey: null, progress: null,
    occurredAt: '2026-10-10T01:00:00Z', createdAt: '2026-10-10T01:00:00Z', ...extra,
  });
  const full = { ...base, events: [...base.events,
    event(4, 'content_manifest', { version: 1, messageId: 'answer', type: 'model_output', chunks: 2, source: 'snapshot', completeness: 'partial' }),
    event(5, 'content_manifest', { version: 1, messageId: 'answer', type: 'model_output', chunks: 2, source: 'canonical', completeness: 'complete' }),
    event(6, 'monitor_state', { version: 1, reportedStatus: 'RUNNING', source: 'live', observedAt: '2026-10-10T01:00:00Z', progress: 45 }),
    event(7, 'monitor_state', { version: 1, reportedStatus: 'PAUSED', source: 'snapshot', observedAt: '2026-10-09T01:00:00Z' }),
  ] };
  const interrupted = { ...base, id: 'mirror-interrupted', title: '中断任务 · 已保留部分回复', status: 'INTERRUPTED', activity: null,
    stateEvidence: { version: 1, reportedStatus: 'INTERRUPTED', source: 'local-run', observedAt: '2026-10-10T01:00:00Z', progress: 32, runEndedAt: '2026-10-10T00:59:00Z' },
    runs: [], events: [
      { ...base.events[0], participationId: null },
      { ...base.events[1], participationId: null, message: '已生成的部分回复。' },
    ],
  };
  const empty = { ...base, id: 'mirror-empty', title: '历史对话 · 源内容不存在', status: 'COMPLETED', progress: 0,
    activity: null, currentStep: null, stateEvidence: null, runs: [], events: [
      { ...base.events[0], participationId: null },
      event(2, 'content_recovery', { version: 1, reason: 'source-missing', checkedAt: '2026-10-10T01:00:00Z', source: 'local-history' }, { participationId: null }),
    ],
  };
  const tasks = [full, interrupted, empty];
  const requests = [];
  const errors = [];
  page.__sepMonitorReview = { requests, errors };
  page.on('pageerror', (error) => errors.push(error.message));
  await page.routeWebSocket('ws://localhost:3001/**', (socket) => socket.onMessage(() => {}));
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/, '');
    requests.push({ method: route.request().method(), path, query: Object.fromEntries(url.searchParams) });
    let status = 200;
    let data;
    if (path === '/auth/refresh') data = { token: 'isolated-browser-fixture', user: { id: 'u-1', email: 'fixture@example.test', name: '用户甲', avatar: null, role: 'USER' }, enterprise: { id: 'enterprise-1', name: '监控验收企业' }, roleInEnterprise: 'ENTERPRISE_ADMIN' };
    else if (path === '/enterprise/info') data = { id: 'enterprise-1', name: '监控验收企业', metadata: { onboardingCompleted: true }, _count: { members: 1, departments: 0, subscriptions: 1 } };
    else if (path === '/tasks') data = { items: [], nextCursor: null };
    else if (path === '/tasks/templates' || path === '/enterprise/my-employees') data = [];
    else if (path === '/cart') data = { items: [], totalItems: 0, totalPrice: 0 };
    else if (path === '/notifications/unread-count') data = { count: 0 };
    else if (path === '/notifications') data = { items: [], total: 0 };
    else if (path === '/announcements/active') data = [];
    else if (path === '/enterprise/employee-status') data = [];
    else if (path === '/client/tasks/filter-options') data = { ...fixtures.clientTaskMonitorOptionsFixture, scopeTotal: 3, counts: { active: 1, attention: 1, history: 3, byStatus: { RUNNING: 1, INTERRUPTED: 1, COMPLETED: 1 } } };
    else if (path === '/client/tasks') {
      let items = tasks;
      if (url.searchParams.get('q')) items = items.filter((task) => task.title.includes(url.searchParams.get('q')));
      if (url.searchParams.get('statuses')) items = items.filter((task) => url.searchParams.get('statuses').split(',').includes(task.status));
      const pageNumber = Number(url.searchParams.get('page') || 1);
      data = { items: pageNumber === 1 ? items : [], total: items.length, page: pageNumber, limit: 50, hasNextPage: false };
    } else if (path.startsWith('/client/tasks/')) data = tasks.find((task) => task.id === path.split('/').at(-1)) || full;
    else if (path.includes('/usage-records/client/')) {
      const id = path.split('/').at(-1);
      if (id === 'denied') { status = 403; data = { message: 'Fixture access denied' }; }
      else if (id === 'legacy') { status = 404; data = { message: 'Legacy-only fixture' }; }
      else data = { source: 'client', recordId: full.id, task: { id: full.id, clientTaskId: full.clientTaskId, title: full.title },
        runs: [{ clientRunId: 'run-1', queuedAt: base.queuedAt, participations: [{ ...base.runs[0].participations[0], events: [
          ...full.events,
          { ...base.events[1], id: 'foreign-body', clientRunId: 'run-foreign', participationId: 'participation-foreign', message: 'FORBIDDEN_OTHER_EMPLOYEE_BODY' },
        ] }] }] };
    } else if (path.includes('/usage-records/client-legacy/')) data = { source: 'client-legacy', recordId: 'legacy',
      task: { id: 'legacy', clientTaskId: 'legacy-task', title: '旧单员工历史对话' },
      run: { clientRunId: 'run-1', status: 'COMPLETED', queuedAt: null, startedAt: null, completedAt: null, usedAt: base.queuedAt, timeBasis: 'legacy-received' },
      events: [{ ...base.events[0], participationId: null }, { ...base.events[1], participationId: null, stepKey: null, message: '当前批次历史回复' },
        { ...base.events[2], clientRunId: 'run-foreign', message: 'FORBIDDEN_LEGACY_BODY' }],
    };
    else { status = 404; data = { message: `Unmapped isolated fixture: ${path}` }; }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('http://localhost:3000/tasks?tab=monitoring');
  await page.getByRole('button', { name: /联调任务/ }).waitFor();
}
