import type { ClientTaskMirrorDetail, ClientTaskMirrorFilterOptions, ClientTaskMirrorPage } from '../use-client-task-mirrors';

// Synthetic authorized responses for component tests and browser route fixtures.
export const clientTaskMonitorDetailFixture: ClientTaskMirrorDetail = {
  id: 'mirror-1', clientTaskId: 'local-task-1', clientRunId: 'run-1',
  userId: 'u-1', user: { id: 'u-1', name: '用户甲' }, enterpriseId: 'enterprise-1',
  subscriptionId: 'sub-1', title: '联调任务', taskType: 'conversation', modelId: 'model-1',
  status: 'RUNNING', progress: 45, currentStep: '处理输入', activity: '生成中', errorSummary: null,
  activityAt: '2026-10-09T01:00:20Z', activityTimeSource: 'event',
  stateEvidence: { version: 1, reportedStatus: 'RUNNING', source: 'live', observedAt: '2026-10-09T02:00:00Z', progress: 45 },
  clientVersion: '2.0.0', protocolVersion: 2, lastSequence: 3,
  lastHeartbeatAt: '2026-10-09T02:00:00Z', queuedAt: '2026-10-09T00:59:00Z',
  startedAt: '2026-10-09T01:00:00Z', completedAt: null,
  createdAt: '2026-10-09T00:59:00Z', updatedAt: '2026-10-09T02:00:00Z',
  subscriptionSummary: { coverage: 'proven', legacySubscriptionId: null, subscriptions: [
    { subscriptionId: 'sub-1', employeeId: 'employee-1', employeeName: '研究员', subscriptionName: '研究助手', executionCount: 1 },
  ] },
  runs: [{
    id: 'db-run-1', clientRunId: 'run-1', subscriptionId: 'sub-1',
    employeeId: 'employee-1', employeeName: '研究员', subscriptionName: '研究助手',
    protocolVersion: 2, queuedAt: '2026-10-09T00:59:00Z', startedAt: '2026-10-09T01:00:00Z',
    completedAt: null, status: 'RUNNING', participations: [{
      id: 'participation-1', executionId: 'execution-1', clientRunId: 'run-1', subscriptionId: 'sub-1',
      employeeId: 'employee-1', employeeName: '研究员', subscriptionName: '研究助手',
      nodeId: 'research', title: '资料研究', modelId: 'model-1', status: 'RUNNING',
      startedAt: '2026-10-09T01:00:00Z', completedAt: null,
    }],
  }],
  events: [
    { id: 'event-1', clientRunId: 'run-1', participationId: 'participation-1', sequence: 1, type: 'user_input', stepKey: null,
      message: '请整理研究结果\n保留出处', progress: null, occurredAt: '2026-10-09T01:00:00Z', createdAt: '2026-10-09T02:00:00Z' },
    { id: 'event-2', clientRunId: 'run-1', participationId: 'participation-1', sequence: 2, type: 'model_output', stepKey: 'content:v1:answer:0:2',
      message: '研究结果\n', progress: null, occurredAt: '2026-10-09T01:00:10Z', createdAt: '2026-10-09T02:00:00Z' },
    { id: 'event-3', clientRunId: 'run-1', participationId: 'participation-1', sequence: 3, type: 'model_output', stepKey: 'content:v1:answer:1:2',
      message: '第二段正文', progress: null, occurredAt: '2026-10-09T01:00:20Z', createdAt: '2026-10-09T02:00:01Z' },
  ],
};

export const clientTaskMonitorPageFixture: ClientTaskMirrorPage = {
  items: [clientTaskMonitorDetailFixture], total: 1, page: 1, limit: 50, hasNextPage: false,
};

export const clientTaskMonitorOptionsFixture: ClientTaskMirrorFilterOptions = {
  users: [{ id: 'u-1', name: '用户甲' }, { id: 'u-2', name: '用户乙' }],
  subscriptions: [{ subscriptionId: 'sub-1', employeeId: 'employee-1', employeeName: '研究员', subscriptionName: '研究助手' }],
  taskTypes: ['conversation', 'workflow'], scopeTotal: 33,
  counts: { active: 1, attention: 0, history: 1, byStatus: {
    QUEUED: 0, RUNNING: 1, WAITING_APPROVAL: 0, PAUSED: 0, COMPLETED: 0, FAILED: 0, CANCELLED: 0, INTERRUPTED: 0,
  } },
};
