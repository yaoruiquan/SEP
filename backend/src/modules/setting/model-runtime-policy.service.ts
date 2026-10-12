import {
  BadRequestException, ConflictException, ForbiddenException, HttpException,
  Injectable, Logger, NotFoundException, ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  MODEL_RUNTIME_POLICY_AUDIT_ACTION, MODEL_RUNTIME_POLICY_FIELDS, MODEL_RUNTIME_POLICY_KEYS,
  MODEL_RUNTIME_POLICY_LEGACY_KEYS, MODEL_RUNTIME_POLICY_REVISION,
  ModelRuntimePolicyHistoryQuerySchema, ModelRuntimePolicyRawValuesSchema,
  RestoreModelRuntimePolicyDtoSchema, UpdateModelRuntimePolicyDtoSchema,
  type ModelRuntimePolicyAdminView, type ModelRuntimePolicyAuditState,
  type ModelRuntimePolicyHistoryItem, type ModelRuntimePolicyHistoryPage,
  type ModelRuntimePolicyHistoryQuery, type ModelRuntimePolicyIssue,
  type ModelRuntimePolicyKey, type ModelRuntimePolicySnapshot,
  type ModelRuntimePolicySource, type ModelRuntimePolicyWriteResult,
  type RestoreModelRuntimePolicyDto, type UpdateModelRuntimePolicyDto,
} from 'shared';
import { PrismaService } from '../../prisma/prisma.service';

const RESOURCE_TYPE = 'MODEL_RUNTIME_POLICY';
const READ_KEYS = [...MODEL_RUNTIME_POLICY_KEYS, MODEL_RUNTIME_POLICY_REVISION, ...MODEL_RUNTIME_POLICY_LEGACY_KEYS];
type SettingRow = { key: string; value: string };
type Sources = Record<ModelRuntimePolicyKey, ModelRuntimePolicySource>;
type Overrides = Record<ModelRuntimePolicyKey, string | null>;

function keyObject<T>(value: (key: ModelRuntimePolicyKey) => T): Record<ModelRuntimePolicyKey, T> {
  return Object.fromEntries(MODEL_RUNTIME_POLICY_KEYS.map((key) => [key, value(key)])) as Record<ModelRuntimePolicyKey, T>;
}

// Audit readers whitelist the complete payload without applying today's hard bounds to history.
const historicalState = z.object({
  version: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  overrides: z.object(keyObject(() => z.string().max(64).nullable())),
  effectivePolicy: z.object(keyObject(() => z.number().int().nonnegative().finite())),
  sources: z.object(keyObject(() => z.enum(['database', 'environment', 'default']))),
});
const auditMetadata = z.object({
  schemaVersion: z.literal(1), reason: z.string().min(1).max(500),
  before: historicalState, after: historicalState,
  restoredFrom: z.object({ historyId: z.string().min(1).max(128), side: z.enum(['before', 'after']) }).optional(),
});

@Injectable()
export class ModelRuntimePolicyService {
  private readonly logger = new Logger(ModelRuntimePolicyService.name);
  private readonly environment: Record<ModelRuntimePolicyKey, string | undefined>;
  private readonly environmentFingerprint: string;
  private readonly expectedEnvironmentFingerprint: string | null;
  private readonly writesConfigured: boolean;

  constructor(private readonly prisma: PrismaService, config: ConfigService) {
    this.environment = keyObject((key) => {
      const raw = config.get<unknown>(key);
      return raw === undefined || raw === null || raw === '' ? undefined : String(raw).trim();
    });
    this.environmentFingerprint = createHash('sha256').update(JSON.stringify(
      MODEL_RUNTIME_POLICY_FIELDS.map((field) => [field.key, this.environment[field.key] ?? field.defaultValue]),
    )).digest('hex');
    this.expectedEnvironmentFingerprint = config.get<string>('MODEL_RUNTIME_POLICY_ENV_FINGERPRINT')?.trim() || null;
    const enabled = config.get<unknown>('MODEL_RUNTIME_POLICY_WRITE_ENABLED');
    this.writesConfigured = enabled === 'true' || enabled === true;
  }

  /** One primary-database read per business request, with no process-local policy cache. */
  async getSnapshot(): Promise<ModelRuntimePolicySnapshot> {
    let policyVersion: number | undefined;
    try {
      return await this.dependency(async () => {
        const rows = await this.readRows(this.prisma);
        policyVersion = this.revision(rows);
        const result = this.resolve(rows);
        if (!result.parsed.success) this.invalidConfiguration(result.issues);
        return Object.freeze({ version: policyVersion, values: Object.freeze(result.parsed.data) });
      });
    } catch (error) {
      if (!(error instanceof ServiceUnavailableException)) throw error;
      const response = error.getResponse();
      const body = typeof response === 'string' ? { message: response } : response as { code?: string; message: string };
      const code = body.code ?? 'MODEL_RUNTIME_POLICY_INVALID';
      throw new ServiceUnavailableException({
        ...body, code,
        error: {
          source: 'platform', type: 'server_error', code, message: body.message,
          ...(policyVersion !== undefined ? { policyVersion } : {}),
        },
      });
    }
  }

  async getForAdmin(): Promise<ModelRuntimePolicyAdminView> {
    return this.dependency(async () => this.adminView(await this.readRows(this.prisma)));
  }

  async update(body: UpdateModelRuntimePolicyDto, actorId: string): Promise<ModelRuntimePolicyWriteResult> {
    const parsed = this.validate(UpdateModelRuntimePolicyDtoSchema, body);
    return this.write(parsed, actorId);
  }

  async history(query: ModelRuntimePolicyHistoryQuery): Promise<ModelRuntimePolicyHistoryPage> {
    const parsed = this.validate(ModelRuntimePolicyHistoryQuerySchema, query);
    return this.dependency(async () => {
      if (parsed.cursor) await this.findHistory(this.prisma, parsed.cursor);
      const rows = await this.prisma.auditLog.findMany({
        where: { action: MODEL_RUNTIME_POLICY_AUDIT_ACTION, resourceType: RESOURCE_TYPE, result: 'SUCCESS' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...(parsed.cursor ? { cursor: { id: parsed.cursor }, skip: 1 } : {}),
        take: parsed.limit + 1,
        select: { id: true, actorId: true, createdAt: true, metadata: true },
      });
      return {
        items: rows.slice(0, parsed.limit).map((row) => this.historyItem(row)),
        nextCursor: rows.length > parsed.limit ? rows[parsed.limit - 1].id : null,
      };
    });
  }

  async restore(body: RestoreModelRuntimePolicyDto, actorId: string): Promise<ModelRuntimePolicyWriteResult> {
    const parsed = this.validate(RestoreModelRuntimePolicyDtoSchema, body);
    this.assertWritable();
    return this.dependency(async () => {
      const item = this.historyItem(await this.findHistory(this.prisma, parsed.historyId));
      const updates = keyObject((key) => item[parsed.side].overrides[key] ?? '');
      // Restoring removes every absent override and revalidates against current deployment fallbacks.
      const update = this.validate(UpdateModelRuntimePolicyDtoSchema, {
        expectedVersion: parsed.expectedVersion, updates, reason: parsed.reason,
      });
      const result = await this.write(update, actorId, { historyId: parsed.historyId, side: parsed.side });
      result.warnings.push('历史恢复只还原数据库覆盖，未覆盖字段使用当前部署环境，不保证复现历史环境下的有效值。');
      return result;
    });
  }

  private async write(
    body: UpdateModelRuntimePolicyDto, actorId: string,
    restoredFrom?: ModelRuntimePolicyHistoryItem['restoredFrom'],
  ): Promise<ModelRuntimePolicyWriteResult> {
    this.assertWritable();
    if (!actorId) throw new ForbiddenException('需要管理员身份');
    return this.dependency(() => this.prisma.$transaction(async (tx) => {
      // ON CONFLICT DO NOTHING makes first-use initialization safe under simultaneous writers.
      await tx.systemSetting.createMany({
        data: [{ key: MODEL_RUNTIME_POLICY_REVISION, value: '0', label: '模型运行策略内部版本', category: 'model-runtime-policy', isSecret: false }],
        skipDuplicates: true,
      });
      const cas = await tx.systemSetting.updateMany({
        where: { key: MODEL_RUNTIME_POLICY_REVISION, value: String(body.expectedVersion) },
        data: { value: String(body.expectedVersion + 1) },
      });
      if (cas.count !== 1) {
        const rows = await this.readRows(tx);
        const currentVersion = this.revision(rows);
        throw new ConflictException({
          code: 'MODEL_RUNTIME_POLICY_VERSION_CONFLICT', expectedVersion: body.expectedVersion, currentVersion,
          message: `模型运行策略版本冲突：提交版本 ${body.expectedVersion}，当前版本 ${currentVersion}；请重新加载并保留草稿。`,
        });
      }
      const rows = await this.readRows(tx);
      const before = this.auditState(rows, body.expectedVersion);
      const merged = new Map(rows.map((row) => [row.key, row.value]));
      for (const [key, value] of Object.entries(body.updates)) {
        if (value === '') merged.delete(key);
        else merged.set(key, value);
      }
      const afterRows = [...merged].map(([key, value]) => ({ key, value }));
      const after = this.auditState(afterRows, body.expectedVersion + 1);
      for (const meta of MODEL_RUNTIME_POLICY_FIELDS) {
        const value = body.updates[meta.key];
        if (value === undefined) continue;
        if (value === '') {
          await tx.systemSetting.deleteMany({ where: { key: meta.key } });
        } else {
          const data = { value, label: meta.label, category: 'model-runtime-policy', isSecret: false };
          await tx.systemSetting.upsert({ where: { key: meta.key }, create: { key: meta.key, ...data }, update: data });
        }
      }
      await tx.auditLog.create({
        data: {
          actorId, action: MODEL_RUNTIME_POLICY_AUDIT_ACTION, resourceType: RESOURCE_TYPE,
          resourceId: MODEL_RUNTIME_POLICY_REVISION, result: 'SUCCESS', summary: body.reason,
          metadata: {
            schemaVersion: 1, reason: body.reason, before, after,
            environmentFingerprint: this.environmentFingerprint,
            ...(restoredFrom ? { restoredFrom } : {}),
          } as unknown as Prisma.InputJsonValue,
        },
      });
      const changes = MODEL_RUNTIME_POLICY_KEYS.filter((key) => before.overrides[key] !== after.overrides[key]).map((key) => ({
        key, before: before.overrides[key], after: after.overrides[key],
        beforeEffectiveValue: before.effectivePolicy[key], afterEffectiveValue: after.effectivePolicy[key],
      }));
      const windowChanged = before.effectivePolicy.GATEWAY_MODEL_RATE_WINDOW_MS !== after.effectivePolicy.GATEWAY_MODEL_RATE_WINDOW_MS;
      return {
        ...this.adminView(afterRows), changes,
        message: `已保存，新请求使用版本 ${after.version}；运行中请求保持原策略。${windowChanged ? '当前计数窗口到期后采用新窗口。' : ''}`,
      };
    }));
  }

  private readRows(client: Pick<Prisma.TransactionClient, 'systemSetting'>): Promise<SettingRow[]> {
    return client.systemSetting.findMany({ where: { key: { in: READ_KEYS } }, select: { key: true, value: true } });
  }

  private revision(rows: SettingRow[]): number {
    const raw = rows.find((row) => row.key === MODEL_RUNTIME_POLICY_REVISION)?.value ?? '0';
    if (!/^(0|[1-9]\d*)$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
      throw new ServiceUnavailableException('模型运行策略内部版本无效，请检查配置');
    }
    return Number(raw);
  }

  private resolve(rows: SettingRow[]) {
    const db = new Map(rows.map((row) => [row.key, row.value]));
    const raw = keyObject((key) => {
      const meta = MODEL_RUNTIME_POLICY_FIELDS.find((field) => field.key === key)!;
      return db.get(key) || (this.environment[key] ?? meta.defaultValue);
    });
    const sources: Sources = keyObject((key) => db.get(key) ? 'database' : this.environment[key] !== undefined ? 'environment' : 'default');
    const parsed = ModelRuntimePolicyRawValuesSchema.safeParse(raw);
    const issues: ModelRuntimePolicyIssue[] = parsed.success ? [] : parsed.error.issues.map((issue) => ({
      key: issue.path[0] as ModelRuntimePolicyKey | undefined, message: issue.message,
    }));
    return { raw, sources, parsed, issues };
  }

  private adminView(rows: SettingRow[]): ModelRuntimePolicyAdminView {
    const result = this.resolve(rows);
    const environment = this.resolve([]);
    const db = new Map(rows.map((row) => [row.key, row.value]));
    const fingerprintMatches = this.expectedEnvironmentFingerprint === this.environmentFingerprint;
    const writeEnabled = this.writesConfigured && fingerprintMatches && environment.parsed.success;
    const legacyOverrides = MODEL_RUNTIME_POLICY_LEGACY_KEYS.filter((key) => db.has(key));
    const warnings = [
      '入口代理超时语义、模型输出能力兼容、发布排空及容器停止宽限需部署核验；后端数值不能证明端到端可用。',
      '企业每分钟预算是保守资源预留，不是实际 Token 或计费额度。',
    ];
    if (!this.writesConfigured) warnings.push('模型运行策略写入尚未开放；所有后端实例完成快照接入后才能开启发布开关。');
    if (!fingerprintMatches) warnings.push('环境指纹未确认或不匹配，禁止写入；部署预检须比较所有实例的指纹并固定同一确认值。');
    if (!environment.parsed.success) warnings.push(`环境回退策略无效：${environment.issues.map((issue) => `${issue.key}: ${issue.message}`).join('；')}`);
    if (legacyOverrides.length) warnings.push(`存在未接入的旧覆盖：${legacyOverrides.join('、')}；历史值保留，不自动映射为新策略。`);
    if (!result.parsed.success) warnings.push('当前有效策略校验失败，新模型请求将被拒绝。');
    return {
      version: this.revision(rows),
      fields: MODEL_RUNTIME_POLICY_FIELDS.map((meta) => {
        const numeric = /^\d+$/.test(result.raw[meta.key].trim()) ? Number(result.raw[meta.key].trim()) : NaN;
        return {
          ...meta, value: db.get(meta.key) ?? '', source: result.sources[meta.key],
          effectiveValue: Number.isFinite(numeric) ? numeric : null,
          editable: writeEnabled,
        };
      }),
      effectivePolicy: result.parsed.success ? result.parsed.data : null,
      warnings, errors: result.issues, writeEnabled,
      preflight: {
        environmentFingerprint: this.environmentFingerprint,
        expectedEnvironmentFingerprint: this.expectedEnvironmentFingerprint,
        environmentValid: environment.parsed.success, fingerprintMatches, writesConfigured: this.writesConfigured,
        legacyOverrides, deploymentVerification: 'required',
      },
    };
  }

  private auditState(rows: SettingRow[], version: number): ModelRuntimePolicyAuditState {
    const result = this.resolve(rows);
    if (!result.parsed.success) throw new BadRequestException({
      code: 'MODEL_RUNTIME_POLICY_INVALID', message: result.issues.map((issue) => `${issue.key}: ${issue.message}`).join('；'),
      errors: result.issues,
    });
    const db = new Map(rows.map((row) => [row.key, row.value]));
    return { version, overrides: keyObject((key) => db.get(key) || null), effectivePolicy: result.parsed.data, sources: result.sources };
  }

  private async findHistory(client: Pick<Prisma.TransactionClient, 'auditLog'>, id: string) {
    const row = await client.auditLog.findFirst({
      where: { id, action: MODEL_RUNTIME_POLICY_AUDIT_ACTION, resourceType: RESOURCE_TYPE, result: 'SUCCESS' },
      select: { id: true, actorId: true, createdAt: true, metadata: true },
    });
    if (!row) throw new NotFoundException('模型运行策略历史记录不存在');
    return row;
  }

  private historyItem(row: { id: string; actorId: string; createdAt: Date; metadata: unknown }): ModelRuntimePolicyHistoryItem {
    const parsed = auditMetadata.safeParse(row.metadata);
    if (!parsed.success) throw new ServiceUnavailableException('模型运行策略审计快照损坏，无法读取或恢复');
    return {
      id: row.id, actorId: row.actorId, createdAt: row.createdAt.toISOString(),
      ...parsed.data,
    } as ModelRuntimePolicyHistoryItem;
  }

  private assertWritable() {
    const environment = this.resolve([]);
    if (!this.writesConfigured || this.expectedEnvironmentFingerprint !== this.environmentFingerprint || !environment.parsed.success) {
      throw new ServiceUnavailableException({
        code: 'MODEL_RUNTIME_POLICY_WRITE_DISABLED',
        message: '模型运行策略写入未开放：需完成全部实例发布、环境有效性及一致指纹预检。',
      });
    }
  }

  private invalidConfiguration(issues: ModelRuntimePolicyIssue[]): never {
    this.logger.error(`Invalid model runtime policy fields: ${issues.map((issue) => issue.key).join(', ')}`);
    throw new ServiceUnavailableException({
      code: 'MODEL_RUNTIME_POLICY_INVALID',
      message: `模型运行策略配置无效：${issues.map((issue) => `${issue.key}: ${issue.message}`).join('；')}`,
      errors: issues,
    });
  }

  private validate<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new BadRequestException({
      message: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('；'),
    });
    return parsed.data;
  }

  private async dependency<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error('Model runtime policy database dependency failed');
      throw new ServiceUnavailableException({ code: 'MODEL_RUNTIME_POLICY_UNAVAILABLE', message: '模型运行策略依赖不可用，请稍后重试' });
    }
  }
}
