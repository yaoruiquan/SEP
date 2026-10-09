import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { SkillVersionStatus } from '@prisma/client';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { PrismaService } from '../src/prisma/prisma.service';
import { EnterpriseContextService } from '../src/modules/enterprise/enterprise-context.service';
import { EnterpriseSkillDefaultService } from '../src/modules/skill-version/enterprise-skill-default.service';
import {
  EnterpriseSkillReviewService,
  PERSONAL_REVIEW_RELATIONS,
  personalReviewState,
} from '../src/modules/skill-version/enterprise-skill-review.service';
import { SkillVersionService } from '../src/modules/skill-version/skill-version.service';
import { PersonalSkillSubmissionService } from '../src/modules/skill-version/personal-skill-submission.service';

const databaseDescribe = process.env.SKILL_REVIEW_DATABASE_TEST === '1' ? describe : describe.skip;
const runFile = promisify(execFile);

function isolatedDatabaseUrl(schema: string, databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) throw new Error('DATABASE_URL is required for the opt-in database tests');
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL must be a valid local PostgreSQL URL');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname) ||
      url.searchParams.has('host') || url.searchParams.has('options')) {
    throw new Error('Database tests require localhost/127.0.0.1/::1 without host or options overrides');
  }
  url.searchParams.set('schema', schema);
  url.searchParams.set('connection_limit', '6');
  return url.toString();
}

databaseDescribe('Enterprise skill review with real PostgreSQL (opt-in, isolated schema)', () => {
  const schema = `skill_review_test_${randomBytes(16).toString('hex')}`;
  let prisma: PrismaService | undefined;
  let schemaCreated = false;
  let schemaDirectory: string | undefined;

  beforeAll(async () => {
    const datasourceUrl = isolatedDatabaseUrl(schema);
    prisma = new PrismaService({ datasourceUrl });
    await prisma.$connect();
    const [vector] = await prisma.$queryRaw<Array<{ namespace: string }>>`
      SELECT n.nspname AS namespace FROM pg_extension e
      JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'vector'
    `;
    if (!vector || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(vector.namespace)) {
      throw new Error('The local database must already have pgvector installed in a standard-named schema');
    }
    // Qualify the existing extension type only in a temporary schema file; never install/move extensions.
    const projectSchema = await readFile(resolve(__dirname, '../prisma/schema.prisma'), 'utf8');
    if (!projectSchema.includes('Unsupported("vector(1024)")')) throw new Error('Unexpected vector schema definition');
    schemaDirectory = await mkdtemp(resolve(tmpdir(), 'sep-skill-review-'));
    const schemaFile = resolve(schemaDirectory, 'schema.prisma');
    await writeFile(schemaFile, projectSchema.replace('Unsupported("vector(1024)")',
      `Unsupported("${vector.namespace}.vector(1024)")`));
    // Only generated identifiers are interpolated; no environment-provided schema is used.
    if (!/^skill_review_test_[a-f0-9]{32}$/.test(schema)) throw new Error('Unsafe test schema name');
    await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    await runFile('pnpm', ['exec', 'prisma', 'db', 'push', '--skip-generate',
      '--schema', schemaFile], {
      cwd: resolve(__dirname, '..'),
      env: { ...process.env, DATABASE_URL: datasourceUrl },
      timeout: 90_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    const [connection] = await prisma.$queryRaw<Array<{ schema: string }>>`SELECT current_schema() AS schema`;
    expect(connection.schema).toBe(schema);
    console.info(`Initialized isolated PostgreSQL schema: ${schema}`);
  }, 120_000);

  afterAll(async () => {
    if (!prisma) return;
    try {
      if (schemaCreated) {
        await prisma.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
        const remaining = await prisma.$queryRaw<Array<{ name: string }>>`
          SELECT nspname AS name FROM pg_namespace WHERE nspname = ${schema}
        `;
        expect(remaining).toEqual([]);
        console.info(`Dropped isolated PostgreSQL schema: ${schema}`);
      }
    } finally {
      try {
        await prisma.$disconnect();
      } finally {
        if (schemaDirectory) await rm(schemaDirectory, { recursive: true, force: true });
      }
    }
  }, 30_000);

  async function fixture() {
    const db = prisma!;
    const suffix = randomBytes(8).toString('hex');
    const admin = await db.user.create({ data: { email: `review-admin-${suffix}@example.test`, name: 'Review admin' } });
    const owner = await db.user.create({ data: { email: `review-owner-${suffix}@example.test`, name: 'Skill owner' } });
    const enterprise = await db.enterprise.create({ data: { name: `Skill review test ${suffix}` } });
    const adminMember = await db.enterpriseMember.create({ data: {
      enterpriseId: enterprise.id, userId: admin.id, role: 'ENTERPRISE_ADMIN',
    } });
    const ownerMember = await db.enterpriseMember.create({ data: {
      enterpriseId: enterprise.id, userId: owner.id, role: 'MEMBER',
    } });
    const capability = await db.capability.create({ data: {
      name: `Review skill ${suffix}`, description: 'Isolated database test', type: 'SKILL',
      industry: [], position: [], inputSchema: {}, outputSchema: {}, contributorId: admin.id,
      enterpriseId: enterprise.id,
    } });
    const platform = await db.skillVersion.create({ data: {
      capabilityId: capability.id, scope: 'PLATFORM', status: 'PLATFORM_APPROVED',
      version: '1.0.0', content: '# Base\n', createdById: admin.id,
    } });
    const base = await db.skillVersion.create({ data: {
      capabilityId: capability.id, enterpriseId: enterprise.id, scope: 'ENTERPRISE', status: 'ENTERPRISE_APPROVED',
      parentVersionId: platform.id, version: '1.0.0', content: '# Base\n', createdById: admin.id,
    } });
    const employee = await createEmployee();
    const subscription = await db.subscription.create({ data: {
      enterpriseId: enterprise.id, employeeId: employee.id, templateVersion: '1.0.0', status: 'ACTIVE',
      grants: { create: { memberId: ownerMember.id } },
    } });
    const context = {
      resolve: jest.fn(async (userId: string) => ({
        enterpriseId: enterprise.id, memberId: userId === admin.id ? adminMember.id : ownerMember.id,
        departmentId: null, role: userId === admin.id ? 'ENTERPRISE_ADMIN' as const : 'MEMBER' as const,
      })),
      assertEnterpriseAdmin: jest.fn((value) => EnterpriseContextService.prototype.assertEnterpriseAdmin(value)),
    } as unknown as EnterpriseContextService;
    const defaults = new EnterpriseSkillDefaultService(db);
    const reviews = new EnterpriseSkillReviewService(db, context, defaults);
    const skills = new SkillVersionService(db, context, defaults, reviews);
    const submissions = new PersonalSkillSubmissionService(db, context, reviews);
    await db.$transaction(async (tx) => {
      await defaults.lock(tx, enterprise.id, capability.id);
      await defaults.set(tx, enterprise.id, capability.id, base.id, admin.id);
    });

    async function createEmployee() {
      return db.digitalEmployee.create({ data: {
        name: `Test employee ${suffix}`, description: 'Isolated database test', industry: 'Test',
        position: 'Test', systemPrompt: 'Test only', status: 'APPROVED',
        bindings: { create: { capabilityId: capability.id, defaultSkillVersionId: platform.id } },
      } });
    }

    async function source(status: SkillVersionStatus = 'PENDING_ENTERPRISE_REVIEW', content = '# Client revision\n') {
      return db.skillVersion.create({ data: {
        ...(status === 'PENDING_ENTERPRISE_REVIEW' ? { id: `psv_${randomBytes(32).toString('hex')}` } : {}),
        capabilityId: capability.id, enterpriseId: enterprise.id, scope: 'PERSONAL',
        status, ownerId: owner.id, createdById: owner.id, parentVersionId: base.id,
        version: base.version, content,
        submittedAt: status === 'PENDING_ENTERPRISE_REVIEW' ? new Date() : null,
        updatedAt: new Date(Date.now() - 60_000),
      } });
    }

    return { db, admin, owner, enterprise, ownerMember, capability, base, subscription,
      defaults, reviews, skills, submissions, source, createEmployee };
  }

  // Pause only after the real PostgreSQL transaction lock is acquired. The second
  // operation finishes its preliminary reads and attempts the same lock before release.
  async function runInLockOrder<T, U>(
    defaults: EnterpriseSkillDefaultService,
    first: () => Promise<T>,
    second: () => Promise<U>,
  ) {
    let announceFirst!: () => void;
    let announceSecond!: () => void;
    let releaseFirst!: () => void;
    const firstLocked = new Promise<void>((resolveSignal) => { announceFirst = resolveSignal; });
    const secondQueued = new Promise<void>((resolveSignal) => { announceSecond = resolveSignal; });
    const released = new Promise<void>((resolveSignal) => { releaseFirst = resolveSignal; });
    const actualLock = defaults.lock.bind(defaults);
    let calls = 0;
    const lock = jest.spyOn(defaults, 'lock').mockImplementation(async (...args) => {
      if (++calls === 1) {
        await actualLock(...args);
        announceFirst();
        await released;
      } else {
        announceSecond();
        await actualLock(...args);
      }
    });
    async function waitForSignal(signal: Promise<void>) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([signal, new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Operation did not reach the shared lock')), 3_000);
        })]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    const tasks: Array<Promise<unknown>> = [];
    try {
      const firstTask = first();
      tasks.push(firstTask);
      void firstTask.catch(() => undefined);
      await waitForSignal(firstLocked);
      const secondTask = second();
      tasks.push(secondTask);
      void secondTask.catch(() => undefined);
      await waitForSignal(secondQueued);
      releaseFirst();
      return await Promise.allSettled([firstTask, secondTask]);
    } finally {
      releaseFirst();
      await Promise.allSettled(tasks);
      lock.mockRestore();
    }
  }

  it('accepts only loopback PostgreSQL URLs and replaces caller-specified schemas', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
      const url = new URL(isolatedDatabaseUrl(schema, `postgresql://user:password@${host}:5432/test?schema=public`));
      expect(url.searchParams.get('schema')).toBe(schema);
    }
    for (const url of [
      'postgresql://user:password@database.example/test',
      'postgresql://user:password@localhost.example/test',
      'postgresql://user:password@192.168.1.1/test',
      'postgresql://user:password@localhost/test?host=database.example',
      'postgresql://user:password@localhost/test?options=-csearch_path%3Dpublic',
      'mysql://user:password@localhost/test',
      'invalid-url',
      '',
    ]) expect(() => isolatedDatabaseUrl(schema, url)).toThrow();
  });

  it('publishes the same client submission once under concurrent approval; the loser gets 409', async () => {
    const f = await fixture();
    const source = await f.source();
    const outcomes = await Promise.allSettled([
      f.reviews.review(f.admin.id, source.id, { decision: 'APPROVE' }),
      f.reviews.review(f.admin.id, source.id, { decision: 'APPROVE' }),
    ]);
    const succeeded = outcomes.filter((outcome) => outcome.status === 'fulfilled');
    const failed = outcomes.filter((outcome) => outcome.status === 'rejected');
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    if (failed[0].status !== 'rejected' || succeeded[0].status !== 'fulfilled') throw new Error('Unexpected approval outcomes');
    expect(failed[0].reason).toBeInstanceOf(ConflictException);
    expect(failed[0].reason.getStatus()).toBe(409);
    const publishedId = succeeded[0].value.publishedVersionId;
    const adoptions = await f.db.skillVersionAdoption.findMany({ where: { sourceVersionId: source.id } });
    expect(adoptions).toHaveLength(1);
    expect(adoptions[0].targetVersionId).toBe(publishedId);
    expect(await f.db.skillVersionReview.count({ where: { versionId: source.id } })).toBe(1);
    expect(await f.db.skillVersion.count({ where: {
      capabilityId: f.capability.id, scope: 'ENTERPRISE', id: { not: f.base.id },
    } })).toBe(1);
    expect((await f.defaults.get(f.enterprise.id, f.capability.id))?.versionId).toBe(publishedId);
    const reviewed = await f.db.skillVersion.findUniqueOrThrow({ where: { id: source.id }, include: PERSONAL_REVIEW_RELATIONS });
    expect(personalReviewState(reviewed)).toMatchObject({ reviewedBy: { id: f.admin.id, name: f.admin.name } });
  }, 30_000);

  it('serializes concurrent approvals of distinct sources into consecutive enterprise semver releases', async () => {
    const f = await fixture();
    const first = await f.source('PENDING_ENTERPRISE_REVIEW', '# First\n');
    const second = await f.source('PENDING_ENTERPRISE_REVIEW', '# Second\n');
    const receipts = await Promise.all([
      f.reviews.review(f.admin.id, first.id, { decision: 'APPROVE' }),
      f.reviews.review(f.admin.id, second.id, { decision: 'APPROVE' }),
    ]);
    const releases = await f.db.skillVersion.findMany({ where: {
      capabilityId: f.capability.id, scope: 'ENTERPRISE', id: { not: f.base.id },
    }, orderBy: { version: 'asc' } });
    expect(releases.map((release) => release.version)).toEqual(['1.0.1', '1.0.2']);
    expect(releases[0].parentVersionId).toBe(f.base.id);
    expect(releases[1].parentVersionId).toBe(releases[0].id);
    expect(new Set(receipts.map((receipt) => receipt.publishedVersionId)).size).toBe(2);
    expect((await f.defaults.get(f.enterprise.id, f.capability.id))?.versionId).toBe(releases[1].id);
    expect(await f.db.skillVersionAdoption.count({ where: { sourceVersionId: { in: [first.id, second.id] } } })).toBe(2);
    expect(await f.db.skillVersionReview.count({ where: { versionId: { in: [first.id, second.id] } } })).toBe(2);
  }, 30_000);

  it('reviews exactly the previewed Web revision, preserves its snapshot, and makes edited content pending again', async () => {
    const f = await fixture();
    const copy = await f.source('PERSONAL_ACTIVE', '# Web revision\n');
    await expect(f.reviews.review(f.admin.id, copy.id, {
      decision: 'APPROVE', expectedUpdatedAt: new Date(copy.updatedAt.getTime() + 1).toISOString(),
    })).rejects.toBeInstanceOf(ConflictException);
    expect(await f.db.skillVersion.count({ where: { workingCopyId: copy.id } })).toBe(0);
    const receipt = await f.reviews.review(f.admin.id, copy.id, {
      decision: 'APPROVE', expectedUpdatedAt: copy.updatedAt.toISOString(),
    });
    const snapshot = await f.db.skillVersion.findFirstOrThrow({ where: { workingCopyId: copy.id } });
    expect(snapshot.workingCopyUpdatedAt).toEqual(copy.updatedAt);
    expect(snapshot.content).toBe(copy.content);
    expect(snapshot.status).toBe('ENTERPRISE_APPROVED');
    const reviewed = await f.db.skillVersion.findUniqueOrThrow({ where: { id: copy.id }, include: PERSONAL_REVIEW_RELATIONS });
    expect(reviewed.updatedAt).toEqual(copy.updatedAt);
    expect(reviewed.status).toBe('PERSONAL_ACTIVE');
    expect(personalReviewState(reviewed)).toMatchObject({ reviewStatus: 'ENTERPRISE_APPROVED',
      pending: false, publishedVersionId: receipt.publishedVersionId,
      reviewedBy: { id: f.admin.id, name: f.admin.name } });

    await f.skills.updatePersonalVersion(f.owner.id, copy.id, { content: '# Edited after review\n' });
    // Clock ordering cannot replace exact revision matching, even if snapshot.createdAt is later.
    const edited = await f.db.skillVersion.update({ where: { id: copy.id },
      data: { updatedAt: new Date(copy.updatedAt.getTime() + 1) }, include: PERSONAL_REVIEW_RELATIONS });
    expect(edited.updatedAt.getTime()).toBeLessThan(snapshot.createdAt.getTime());
    expect(personalReviewState(edited)).toMatchObject({ reviewStatus: 'PENDING_ENTERPRISE_REVIEW',
      pending: true, publishedVersionId: null, reviewedBy: null });
    await expect(f.reviews.review(f.admin.id, copy.id, {
      decision: 'APPROVE', expectedUpdatedAt: copy.updatedAt.toISOString(),
    })).rejects.toBeInstanceOf(ConflictException);
    const second = await f.reviews.review(f.admin.id, copy.id, {
      decision: 'APPROVE', expectedUpdatedAt: edited.updatedAt.toISOString(),
    });
    expect(second.publishedVersionId).not.toBe(receipt.publishedVersionId);
    expect(await f.db.skillVersion.count({ where: { workingCopyId: copy.id } })).toBe(2);
    expect((await f.db.skillVersion.findUniqueOrThrow({ where: { id: snapshot.id } })).content).toBe(copy.content);
    expect((await f.db.skillVersion.findUniqueOrThrow({ where: { id: second.publishedVersionId! } })).content)
      .toBe('# Edited after review\n');
  }, 30_000);

  it.each(['review', 'discard'] as const)(
    'serializes concurrent Web review/discard with %s first and retains every published snapshot source', async (first) => {
      const f = await fixture();
      const copy = await f.source('PERSONAL_ACTIVE', '# Review versus discard\n');
      const review = () => f.reviews.review(f.admin.id, copy.id, {
        decision: 'APPROVE', expectedUpdatedAt: copy.updatedAt.toISOString(),
      });
      const discard = () => f.skills.discardPersonalVersion(f.owner.id, copy.id);
      if (first === 'review') {
        const [reviewed, discarded] = await runInLockOrder(f.defaults, review, discard);
        expect(reviewed.status).toBe('fulfilled');
        expect(discarded.status).toBe('fulfilled');
        if (reviewed.status !== 'fulfilled' || discarded.status !== 'fulfilled') throw new Error('Expected review and archive');
        expect(discarded.value).toMatchObject({ id: copy.id, status: 'ARCHIVED' });
        const retained = await f.db.skillVersion.findUniqueOrThrow({ where: { id: copy.id } });
        expect(retained.status).toBe('ARCHIVED');
        expect(retained.content).toBe(copy.content);
        const snapshots = await f.db.skillVersion.findMany({ where: { workingCopyId: copy.id } });
        expect(snapshots).toHaveLength(1);
        expect(snapshots[0]).toMatchObject({ workingCopyId: retained.id, content: copy.content,
          workingCopyUpdatedAt: copy.updatedAt, status: 'ENTERPRISE_APPROVED' });
        const adoption = await f.db.skillVersionAdoption.findFirstOrThrow({ where: { sourceVersionId: snapshots[0].id } });
        expect(adoption.targetVersionId).toBe(reviewed.value.publishedVersionId);
        expect(await f.db.skillVersionReview.count({ where: { versionId: snapshots[0].id } })).toBe(1);
        expect((await f.defaults.get(f.enterprise.id, f.capability.id))?.versionId).toBe(reviewed.value.publishedVersionId);
      } else {
        const [discarded, reviewed] = await runInLockOrder(f.defaults, discard, review);
        expect(discarded.status).toBe('fulfilled');
        expect(reviewed.status).toBe('rejected');
        if (discarded.status !== 'fulfilled' || reviewed.status !== 'rejected') throw new Error('Expected deletion before review');
        expect(discarded.value).toEqual({ id: copy.id, deleted: true });
        expect(reviewed.reason).toBeInstanceOf(NotFoundException);
        expect(await f.db.skillVersion.findUnique({ where: { id: copy.id } })).toBeNull();
        expect(await f.db.skillVersion.count({ where: { workingCopyId: copy.id } })).toBe(0);
        expect(await f.db.skillVersion.count({ where: { capabilityId: f.capability.id, scope: 'ENTERPRISE' } })).toBe(1);
        expect(await f.db.skillVersionReview.count({ where: { version: { capabilityId: f.capability.id } } })).toBe(0);
        expect(await f.db.skillVersionAdoption.count({ where: { targetVersion: { capabilityId: f.capability.id } } })).toBe(0);
        expect((await f.defaults.get(f.enterprise.id, f.capability.id))?.versionId).toBe(f.base.id);
      }
    }, 30_000,
  );

  it.each(['publish', 'edit'] as const)(
    'serializes concurrent enterprise draft publish/edit with %s first and makes published content immutable', async (first) => {
      const f = await fixture();
      const draft = await f.db.skillVersion.create({ data: {
        capabilityId: f.capability.id, enterpriseId: f.enterprise.id, scope: 'ENTERPRISE', status: 'DRAFT',
        version: '1.0.1', content: '# Original draft\n', parentVersionId: f.base.id, createdById: f.admin.id,
      } });
      const publish = () => f.skills.publishEnterpriseVersion(f.admin.id, draft.id);
      const edit = () => f.skills.updateEnterpriseVersion(f.admin.id, draft.id, { content: '# Edited draft\n' });
      if (first === 'publish') {
        const [published, edited] = await runInLockOrder(f.defaults, publish, edit);
        expect(published.status).toBe('fulfilled');
        expect(edited.status).toBe('rejected');
        if (edited.status !== 'rejected') throw new Error('Published draft must reject the waiting edit');
        expect(edited.reason).toBeInstanceOf(ConflictException);
        expect(edited.reason.getStatus()).toBe(409);
      } else {
        const [edited, published] = await runInLockOrder(f.defaults, edit, publish);
        expect(edited.status).toBe('fulfilled');
        expect(published.status).toBe('fulfilled');
      }
      const published = await f.db.skillVersion.findUniqueOrThrow({ where: { id: draft.id } });
      expect(published.status).toBe('ENTERPRISE_APPROVED');
      expect(published.content).toBe(first === 'publish' ? draft.content : '# Edited draft\n');
      expect((await f.defaults.get(f.enterprise.id, f.capability.id))?.versionId).toBe(draft.id);
      expect(await f.db.skillVersionReview.count({ where: { versionId: draft.id } })).toBe(1);
      await expect(f.skills.updateEnterpriseVersion(f.admin.id, draft.id, { content: '# Post-publication overwrite\n' }))
        .rejects.toBeInstanceOf(ConflictException);
      expect(await f.db.skillVersion.findUniqueOrThrow({ where: { id: draft.id } })).toEqual(published);
    }, 30_000,
  );

  it.each(['PENDING_ENTERPRISE_REVIEW', 'PERSONAL_ACTIVE'] as const)(
    'rolls back source, audit, publication, adoption and defaults when the default write fails (%s)', async (status) => {
      const f = await fixture();
      const source = await f.source(status);
      async function persistedState() {
        return {
          sources: await f.db.skillVersion.findMany({ where: { capabilityId: f.capability.id }, orderBy: { id: 'asc' } }),
          reviews: await f.db.skillVersionReview.findMany({ where: { version: { capabilityId: f.capability.id } } }),
          adoptions: await f.db.skillVersionAdoption.findMany({ where: { targetVersion: { capabilityId: f.capability.id } } }),
          defaults: await f.defaults.get(f.enterprise.id, f.capability.id),
          selections: await f.db.subscriptionSkillVersion.findMany({ where: { subscriptionId: f.subscription.id } }),
          notifications: await f.db.notification.findMany({ where: { relatedId: f.capability.id } }),
        };
      }
      const before = await persistedState();
      const actualSet = f.defaults.set.bind(f.defaults);
      const failure = new Error('Injected failure after real default writes');
      const set = jest.spyOn(f.defaults, 'set').mockImplementationOnce(async (...args) => {
        await actualSet(...args);
        throw failure;
      });
      try {
        await expect(f.reviews.review(f.admin.id, source.id, {
          decision: 'APPROVE', expectedUpdatedAt: source.updatedAt.toISOString(),
        })).rejects.toBe(failure);
        expect(set).toHaveBeenCalledTimes(1);
        expect(await persistedState()).toEqual(before);
      } finally {
        set.mockRestore();
      }
    }, 30_000,
  );

  it('expired member grants hide employee relationships while retaining readable enterprise publications', async () => {
    const f = await fixture();
    const copy = await f.source('PERSONAL_ACTIVE');
    const changed = await f.db.employeeGrant.updateMany({ where: {
      subscriptionId: f.subscription.id, memberId: f.ownerMember.id,
    }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    expect(changed.count).toBe(1);
    const directory = await f.skills.listIterableCapabilities(f.owner.id);
    expect(directory.items).toHaveLength(1);
    expect(directory.items[0]).toMatchObject({ capability: { id: f.capability.id }, employees: [],
      currentVersion: { id: f.base.id } });
    const timeline = await f.skills.listVersionTimeline(f.owner.id, f.capability.id);
    expect(timeline.subscriptions).toEqual([]);
    expect(timeline.versions).toContainEqual(expect.objectContaining({ id: f.base.id }));
    expect(await f.submissions.list(f.owner.id, f.capability.id))
      .toContainEqual(expect.objectContaining({ id: f.base.id, status: 'ENTERPRISE_APPROVED' }));
    await expect(f.skills.updatePersonalVersion(f.owner.id, copy.id, { content: 'Forbidden overwrite' }))
      .rejects.toBeInstanceOf(ForbiddenException);
    await expect(f.skills.discardPersonalVersion(f.owner.id, copy.id)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(f.submissions.submit(f.owner.id, `request-${randomBytes(16).toString('hex')}`, {
      capabilityId: f.capability.id, parentVersionId: f.base.id, content: 'Forbidden submission',
    })).rejects.toBeInstanceOf(NotFoundException);
    expect(await f.db.skillVersion.findUniqueOrThrow({ where: { id: copy.id } })).toEqual(copy);
    expect(await f.db.skillVersion.count({ where: { capabilityId: f.capability.id, scope: 'PERSONAL' } })).toBe(1);
    const adminDirectory = await f.skills.listIterableCapabilities(f.admin.id);
    expect(adminDirectory.items[0].employees).toHaveLength(1);
  }, 30_000);

  it('new subscriptions inherit the rolled-back enterprise default while member-pinned versions stay unchanged', async () => {
    const f = await fixture();
    const source = await f.source();
    const receipt = await f.reviews.review(f.admin.id, source.id, { decision: 'APPROVE' });
    const pinned = await f.skills.selectPersonalVersion(f.owner.id, f.subscription.id,
      f.capability.id, receipt.publishedVersionId!);
    await f.skills.setEnterpriseDefault(f.admin.id, f.capability.id, f.base.id);
    expect((await f.defaults.get(f.enterprise.id, f.capability.id))?.versionId).toBe(f.base.id);
    expect((await f.db.subscriptionSkillVersion.findUniqueOrThrow({ where: { subscriptionId_capabilityId: {
      subscriptionId: f.subscription.id, capabilityId: f.capability.id,
    } } })).versionId).toBe(f.base.id);
    expect(await f.db.memberSkillVersionSelection.findUniqueOrThrow({ where: { id: pinned.id } })).toEqual(pinned);

    const newEmployee = await f.createEmployee();
    const newSubscription = await f.db.subscription.create({ data: {
      enterpriseId: f.enterprise.id, employeeId: newEmployee.id, templateVersion: '1.0.0', status: 'ACTIVE',
    } });
    expect(await f.db.subscriptionSkillVersion.count({ where: { subscriptionId: newSubscription.id } })).toBe(0);
    expect((await f.skills.resolveEffectiveVersion(newSubscription.id, f.capability.id))?.id).toBe(f.base.id);
    expect((await f.skills.resolveEffectiveVersion(newSubscription.id, f.capability.id, f.owner.id))?.id).toBe(f.base.id);
    expect((await f.skills.resolveEffectiveVersion(f.subscription.id, f.capability.id, f.owner.id))?.id)
      .toBe(receipt.publishedVersionId);
    expect(await f.db.skillVersion.count({ where: { id: { in: [f.base.id, receipt.publishedVersionId!] } } })).toBe(2);
  }, 30_000);
});
