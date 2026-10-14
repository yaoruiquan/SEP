/**
 * Run manually against an ISOLATED local business database (Node >= 20):
 *   SEP_PI_MEDIA_MOCK_REVIEW=true
 *   SEP_PI_MEDIA_MOCK_DATABASE=sep_pi_media_mock_<suffix>
 *   SEP_PI_MEDIA_MOCK_API_URL=http://127.0.0.1:<isolated-port>/api
 *   SEP_PI_MEDIA_MOCK_DEMO_PASSWORD=<local demo password>
 *   node backend/test/prepare-ecommerce-image-mock.mjs
 * ADMIN_PASSWORD, STAFF_PASSWORD, and BOSS_PASSWORD with the same
 * SEP_PI_MEDIA_MOCK_ prefix can override the common demo password.
 *
 * These env assertions DO NOT prove that the server uses an isolated DB.
 * Verify its business Prisma datasource separately before running. A separate
 * media mock DB or port does not isolate business writes. The server must expose
 * CapabilityModule, DigitalEmployeeModule, SkillVersionModule, and real auth.
 * This flow makes the NEW capability MARKET_PUBLIC and adds a GLOBAL template
 * binding, but only in the target DB. Never point it at the original business DB.
 * It never updates the original operator capability or invokes media execution.
 * It uses real HTTP, not E2E auth bypasses, DB access, seeds, or provider calls.
 * No retries/rollback: a failed run may leave partial records in the isolated DB.
 * Each invocation creates a new capability; inspect failure evidence before rerun.
 * Tokens/passwords stay in memory. Neither HTTP bodies nor raw errors are logged.
 */

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile } from 'node:fs/promises';
import { Agent, request as httpRequest } from 'node:http';

const EMPLOYEE_ID = 'cmt2lfhh2001k7qarjhnng753';
const SUBSCRIPTION_ID = 'cmtcb9d8v003q7qmp2usv9ls7';
const OPERATOR_ID = 'cmt2lfhgs001i7qar4u8acc1u';
const FIXTURE = new URL('./fixtures/ecommerce-image-mock/SKILL.md', import.meta.url);
const OUTPUTS = new URL('../../outputs/pi-media-mock-review/', import.meta.url);
const ID = /^[A-Za-z0-9_-]{1,128}$/;

class SafeFailure extends Error {
  constructor(code) {
    super(code);
    this.name = 'SafeFailure';
  }
}

function requireCondition(condition, code) {
  if (!condition) throw new SafeFailure(code);
}

function resourceId(value) {
  requireCondition(typeof value === 'string' && ID.test(value), 'INVALID_RESOURCE_ID');
  return value;
}

function timestamp(value) {
  requireCondition(typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value)), 'INVALID_VERSION_TIMESTAMP');
  return value;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function configuration() {
  requireCondition(process.env.SEP_PI_MEDIA_MOCK_REVIEW === 'true', 'REVIEW_OPT_IN_REQUIRED');
  const database = process.env.SEP_PI_MEDIA_MOCK_DATABASE;
  requireCondition(typeof database === 'string' && /^sep_pi_media_mock_[a-z0-9_]+$/.test(database),
    'ISOLATED_DATABASE_ASSERTION_REQUIRED');
  let base;
  try { base = new URL(process.env.SEP_PI_MEDIA_MOCK_API_URL); }
  catch { throw new SafeFailure('EXPLICIT_LOOPBACK_API_URL_REQUIRED'); }
  requireCondition(base.protocol === 'http:' &&
    ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) &&
    !base.username && !base.password && !base.search && !base.hash &&
    ['/', '/api', '/api/'].includes(base.pathname), 'LOOPBACK_HTTP_API_ONLY');
  // Avoid relying on localhost DNS resolution to keep the transport loopback-only.
  if (base.hostname === 'localhost') base.hostname = '127.0.0.1';
  base.pathname = '/api/';
  const accounts = [
    ['admin', 'admin@sep.local'], ['staff', 'staff@acme.local'], ['boss', 'boss@acme.local'],
  ].map(([role, email]) => {
    const password = process.env[`SEP_PI_MEDIA_MOCK_${role.toUpperCase()}_PASSWORD`] ??
      process.env.SEP_PI_MEDIA_MOCK_DEMO_PASSWORD;
    requireCondition(typeof password === 'string' && password.length > 0, 'DEMO_PASSWORD_REQUIRED');
    return { role, email, password };
  });
  return { base, database, accounts };
}

// Explicit allowlist: never persist a raw capability/version/login response.
function versionEvidence(value) {
  requireCondition(value && typeof value === 'object', 'VERSION_RESPONSE_REQUIRED');
  requireCondition(['PLATFORM', 'PERSONAL', 'ENTERPRISE'].includes(value.scope) &&
    ['PLATFORM_APPROVED', 'PENDING_ENTERPRISE_REVIEW', 'ENTERPRISE_APPROVED'].includes(value.status),
  'UNEXPECTED_VERSION_STATE');
  requireCondition(typeof value.version === 'string' && /^[A-Za-z0-9.+_-]{1,128}$/.test(value.version),
    'INVALID_VERSION_NUMBER');
  return {
    id: resourceId(value.id), capabilityId: resourceId(value.capabilityId),
    scope: value.scope, status: value.status, version: value.version,
    enterpriseId: value.enterpriseId == null ? null : resourceId(value.enterpriseId),
    parentVersionId: value.parentVersionId == null ? null : resourceId(value.parentVersionId),
    updatedAt: timestamp(value.updatedAt),
    enterpriseReviewedAt: value.enterpriseReviewedAt == null ? null : timestamp(value.enterpriseReviewedAt),
    platformReviewedAt: value.platformReviewedAt == null ? null : timestamp(value.platformReviewedAt),
  };
}

function originalSkillDigest(list) {
  const skill = list.skills.find((item) => item.capability?.id === OPERATOR_ID);
  requireCondition(skill && Array.isArray(skill.versions), 'ORIGINAL_OPERATOR_MISSING');
  const summarize = (value) => value == null ? null : versionEvidence(value);
  return sha256(JSON.stringify({
    currentVersion: summarize(skill.currentVersion),
    enterpriseVersion: summarize(skill.enterpriseVersion),
    latestPublishedVersion: summarize(skill.latestPublishedVersion),
    versions: skill.versions.map(summarize).sort((a, b) => a.id.localeCompare(b.id)),
  }));
}

async function runReview() {
  const config = configuration();
  const fixtureBytes = await readFile(FIXTURE);
  const content = new TextDecoder('utf-8', { fatal: true }).decode(fixtureBytes);
  requireCondition(fixtureBytes.length > 0 && fixtureBytes.length <= 500 * 1024 &&
    content.startsWith('---\n') && content.includes('SEP_ECOMMERCE_IMAGE_MOCK_V1'),
  'EXPECTED_MOCK_FIXTURE_REQUIRED');
  const fixtureHash = sha256(fixtureBytes);
  const runId = randomUUID();
  const relativeEvidencePath = `outputs/pi-media-mock-review/${runId}.json`;
  const evidence = {
    schemaVersion: 1, runId, outcome: 'IN_PROGRESS', startedAt: new Date().toISOString(),
    evidenceFile: relativeEvidencePath,
    scope: {
      apiBase: config.base.href, databaseAssertion: config.database,
      databaseIsolationVerified: false, employeeId: EMPLOYEE_ID, subscriptionId: SUBSCRIPTION_ID,
      originalOperatorCapabilityId: OPERATOR_ID,
      newCapabilityBecomesMarketPublic: true, bindingIsGlobalWithinTargetDatabase: true,
      productionMediaInvoked: false,
    },
    fixture: {
      path: 'backend/test/fixtures/ecommerce-image-mock/SKILL.md',
      bytes: fixtureBytes.length, sha256: fixtureHash,
    },
    checkpoints: {}, requests: [],
  };
  // Check output writability before the first login or business mutation.
  await mkdir(OUTPUTS, { recursive: true });
  const output = await open(new URL(`${runId}.json`, OUTPUTS), 'wx', 0o600);
  // Explicit native agent: no proxy discovery or redirect handling.
  const agent = new Agent({ keepAlive: false });
  const tokens = new Map();
  let stage = 'PREFLIGHT';

  async function request(step, method, path, role, body, idempotencyKey) {
    stage = step;
    const url = new URL(path, config.base);
    requireCondition(url.origin === config.base.origin && url.pathname.startsWith('/api/') &&
      !url.search && !url.hash, 'REQUEST_OUTSIDE_LOOPBACK_API');
    const receipt = { step, method, path: url.pathname, httpStatus: null, outcome: 'IN_FLIGHT' };
    evidence.requests.push(receipt);
    const headers = { Accept: 'application/json' };
    if (role) {
      requireCondition(tokens.has(role), 'AUTH_TOKEN_UNAVAILABLE');
      headers.Authorization = `Bearer ${tokens.get(role)}`;
    }
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (idempotencyKey !== undefined) {
      requireCondition(/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey), 'INVALID_IDEMPOTENCY_KEY');
      headers['Idempotency-Key'] = idempotencyKey;
    }
    const payload = body === undefined ? undefined : JSON.stringify(body);
    if (payload !== undefined) headers['Content-Length'] = Buffer.byteLength(payload);
    try {
      return await new Promise((resolve, reject) => {
        const req = httpRequest(url, {
          method, headers, agent, signal: AbortSignal.timeout(30_000),
        }, (response) => {
          receipt.httpStatus = response.statusCode ?? null;
          // All redirects are errors; never forward credentials to another target.
          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
            receipt.outcome = 'HTTP_FAILED';
            response.destroy();
            reject(new SafeFailure('HTTP_REQUEST_REJECTED'));
            return;
          }
          const chunks = [];
          let bytes = 0;
          response.on('error', () => reject(new SafeFailure('HTTP_RESPONSE_TRANSPORT_FAILED')));
          response.on('data', (chunk) => {
            bytes += chunk.length;
            if (bytes > 2 * 1024 * 1024) {
              receipt.outcome = 'INVALID_RESPONSE';
              response.destroy();
              reject(new SafeFailure('HTTP_RESPONSE_TOO_LARGE'));
            } else chunks.push(chunk);
          });
          response.on('end', () => {
            try {
              const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
              requireCondition(result && typeof result === 'object' && !Array.isArray(result),
                'JSON_OBJECT_REQUIRED');
              receipt.outcome = 'OK';
              resolve(result);
            } catch {
              receipt.outcome = 'INVALID_RESPONSE';
              reject(new SafeFailure('HTTP_RESPONSE_INVALID'));
            }
          });
        });
        req.on('error', () => reject(new SafeFailure('HTTP_TRANSPORT_FAILED_NO_RETRY')));
        req.end(payload);
      });
    } catch (error) {
      if (receipt.outcome === 'IN_FLIGHT') receipt.outcome = 'TRANSPORT_FAILED';
      throw error instanceof SafeFailure ? error : new SafeFailure('HTTP_TRANSPORT_FAILED_NO_RETRY');
    }
  }

  async function skills(step) {
    const result = await request(step, 'GET', `enterprise/employees/${EMPLOYEE_ID}/skills`, 'staff');
    requireCondition(result.subscriptionId === SUBSCRIPTION_ID && Array.isArray(result.skills),
      'STAFF_SUBSCRIPTION_MISMATCH');
    return result;
  }

  try {
    console.error('WARNING: env assertions do not prove DB isolation. This flow publishes a new capability and adds a global binding in the target DB.');
    const identities = {};
    for (const account of config.accounts) {
      const result = await request(`LOGIN_${account.role.toUpperCase()}`, 'POST', 'auth/login', null,
        { email: account.email, password: account.password });
      requireCondition(typeof result.token === 'string' && result.token.length > 0 &&
        result.user?.email === account.email, 'DEMO_LOGIN_RESPONSE_INVALID');
      tokens.set(account.role, result.token);
      identities[account.role] = {
        id: resourceId(result.user.id), role: result.user.role,
        enterpriseId: result.enterprise == null ? null : resourceId(result.enterprise.id),
        roleInEnterprise: result.roleInEnterprise,
      };
    }
    requireCondition(identities.admin.role === 'ADMIN' && identities.staff.roleInEnterprise === 'MEMBER' &&
      identities.boss.roleInEnterprise === 'ENTERPRISE_ADMIN' && identities.staff.enterpriseId &&
      identities.staff.enterpriseId === identities.boss.enterpriseId, 'DEMO_ROLE_OR_ENTERPRISE_MISMATCH');
    const enterpriseId = identities.staff.enterpriseId;
    const before = await skills('STAFF_PREFLIGHT');
    const originalDigest = originalSkillDigest(before);
    evidence.checkpoints.originalOperatorBefore = { summarySha256: originalDigest };
    const original = await request('CAPABILITY_ROUTE_PREFLIGHT', 'GET', `capabilities/${OPERATOR_ID}`, 'admin');
    requireCondition(original.id === OPERATOR_ID && original.type === 'SKILL', 'OPERATOR_CAPABILITY_MISMATCH');
    requireCondition(original.updatedAt && Number.isFinite(Date.parse(original.updatedAt)),
      'OPERATOR_TIMESTAMP_REQUIRED');
    const originalUpdatedAt = original.updatedAt;

    const created = await request('CREATE_NEW_CAPABILITY', 'POST', 'capabilities', 'admin', {
      name: `Ecommerce Image Mock ${runId}`, description: 'Isolated local mock-only ecommerce image review fixture.',
      type: 'skill', industry: ['E-Commerce'], position: ['Operations'],
      inputSchema: { type: 'object' }, outputSchema: { type: 'object' },
      skillConfig: { template: content },
    });
    const capabilityId = resourceId(created.id);
    requireCondition(capabilityId !== OPERATOR_ID && created.type === 'SKILL' && created.enterpriseId == null,
      'NEW_PLATFORM_CAPABILITY_REQUIRED');
    evidence.checkpoints.createdCapability = { id: capabilityId };

    const approved = await request('APPROVE_NEW_CAPABILITY', 'POST', `capabilities/${capabilityId}/approve`, 'admin');
    requireCondition(approved.id === capabilityId && approved.status === 'APPROVED' &&
      approved.visibility === 'MARKET_PUBLIC' && approved.platformReviewStatus === 'APPROVED',
    'PLATFORM_APPROVAL_NOT_CONFIRMED');
    evidence.checkpoints.platformApproval = {
      capabilityId, status: 'APPROVED', visibility: 'MARKET_PUBLIC', platformReviewStatus: 'APPROVED',
    };
    const binding = await request('BIND_NEW_CAPABILITY', 'POST', `digital-employees/${EMPLOYEE_ID}/capabilities`,
      'admin', { capabilityId, priority: 100 });
    requireCondition(binding.employeeId === EMPLOYEE_ID && binding.capabilityId === capabilityId &&
      binding.enabled === true, 'BINDING_NOT_CONFIRMED');
    evidence.checkpoints.binding = {
      id: resourceId(binding.id), employeeId: EMPLOYEE_ID, capabilityId,
      defaultSkillVersionId: resourceId(binding.defaultSkillVersionId),
    };

    const withBinding = await skills('STAFF_PARENT_LOOKUP');
    const parent = withBinding.skills.find((item) => item.capability?.id === capabilityId)?.currentVersion;
    requireCondition(parent?.capabilityId === capabilityId && parent.scope === 'PLATFORM' &&
      parent.status === 'PLATFORM_APPROVED' && parent.id === binding.defaultSkillVersionId,
    'APPROVED_PLATFORM_PARENT_REQUIRED');
    evidence.checkpoints.parentVersion = versionEvidence(parent);
    const key = `ecommerce_image_mock_${runId}`;
    const submitted = await request('STAFF_SUBMIT_FULL_FIXTURE', 'POST', 'enterprise/skill-versions', 'staff', {
      capabilityId, parentVersionId: resourceId(parent.id), content,
      changeSummary: 'Mock-only ecommerce image workflow acceptance; no production media.',
    }, key);
    const submissionId = resourceId(submitted.id);
    requireCondition(submitted.capabilityId === capabilityId && submitted.enterpriseId === enterpriseId &&
      submitted.scope === 'PERSONAL' && submitted.status === 'PENDING_ENTERPRISE_REVIEW' &&
      submitted.content === content && submitted.parentVersionId === parent.id, 'SUBMISSION_NOT_CONFIRMED');
    evidence.checkpoints.submission = { ...versionEvidence(submitted), sha256: sha256(submitted.content) };

    const preview = await request('BOSS_PREVIEW_SUBMISSION', 'GET',
      `enterprise/skill-versions/${submissionId}/preview`, 'boss');
    requireCondition(preview.id === submissionId && preview.capabilityId === capabilityId &&
      preview.enterpriseId === enterpriseId && preview.scope === 'PERSONAL' &&
      preview.status === 'PENDING_ENTERPRISE_REVIEW' && preview.content === content &&
      sha256(preview.content) === fixtureHash, 'REVIEW_PREVIEW_MISMATCH');
    const expectedUpdatedAt = timestamp(preview.updatedAt);
    evidence.checkpoints.reviewPreview = { ...versionEvidence(preview), sha256: fixtureHash };
    const reviewed = await request('BOSS_REVIEW_APPROVE', 'POST',
      `enterprise/skill-versions/${submissionId}/review`, 'boss', {
        decision: 'APPROVE', expectedUpdatedAt, comment: 'Approved for isolated mock-only acceptance.',
      });
    const publishedId = resourceId(reviewed.publishedVersionId);
    requireCondition(reviewed.id === submissionId && reviewed.capabilityId === capabilityId &&
      reviewed.enterpriseId === enterpriseId && reviewed.status === 'ENTERPRISE_APPROVED' &&
      publishedId !== submissionId && Number.isSafeInteger(reviewed.affectedSubscriptions) &&
      reviewed.affectedSubscriptions >= 1, 'ENTERPRISE_APPROVAL_NOT_CONFIRMED');
    evidence.checkpoints.enterpriseApproval = {
      ...versionEvidence(reviewed), decision: 'APPROVE', expectedUpdatedAt,
      publishedVersionId: publishedId, affectedSubscriptions: reviewed.affectedSubscriptions,
    };
    const published = await request('BOSS_PREVIEW_PUBLISHED', 'GET',
      `enterprise/skill-versions/${publishedId}/preview`, 'boss');
    requireCondition(published.id === publishedId && published.capabilityId === capabilityId &&
      published.enterpriseId === enterpriseId && published.scope === 'ENTERPRISE' &&
      published.status === 'ENTERPRISE_APPROVED' && published.content === content &&
      sha256(published.content) === fixtureHash, 'PUBLISHED_FIXTURE_MISMATCH');
    evidence.checkpoints.publishedVersion = { ...versionEvidence(published), sha256: fixtureHash };
    const after = await skills('STAFF_CONFIRM_EFFECTIVE_VERSION');
    const current = after.skills.find((item) => item.capability?.id === capabilityId)?.currentVersion;
    requireCondition(current?.id === publishedId && current.scope === 'ENTERPRISE' &&
      current.status === 'ENTERPRISE_APPROVED' && current.enterpriseId === enterpriseId,
    'STAFF_EFFECTIVE_VERSION_MISMATCH');
    evidence.checkpoints.staffEffectiveVersion = versionEvidence(current);
    const afterDigest = originalSkillDigest(after);
    const originalAfter = await request('CONFIRM_ORIGINAL_OPERATOR', 'GET', `capabilities/${OPERATOR_ID}`, 'admin');
    requireCondition(originalAfter.id === OPERATOR_ID && originalAfter.updatedAt === originalUpdatedAt &&
      afterDigest === originalDigest, 'ORIGINAL_OPERATOR_CHANGED');
    evidence.checkpoints.originalOperatorAfter = { summarySha256: afterDigest, unchanged: true };
    evidence.outcome = 'COMPLETE';
    return evidence;
  } catch (error) {
    evidence.outcome = 'FAILED';
    evidence.failure = {
      stage, code: error instanceof SafeFailure ? error.message : 'UNEXPECTED_FAILURE_DETAILS_SUPPRESSED',
      partialWritesPossible: evidence.requests.some((entry) => entry.method === 'POST'),
    };
    throw new SafeFailure(`REVIEW_FAILED_${stage}`);
  } finally {
    tokens.clear();
    agent.destroy();
    evidence.finishedAt = new Date().toISOString();
    try { await output.writeFile(`${JSON.stringify(evidence, null, 2)}\n`, 'utf8'); }
    finally { await output.close(); }
    console.error(`Sanitized evidence: ${relativeEvidencePath}`);
  }
}

runReview().then((result) => {
  console.log(JSON.stringify(result, null, 2));
}).catch((error) => {
  console.error(error instanceof SafeFailure ? error.message : 'PREPARATION_FAILED_DETAILS_SUPPRESSED');
  process.exitCode = 1;
});
