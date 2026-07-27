import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { SettingService } from "../setting/setting.service";
import { SETTING_KEYS, hasPricing } from "shared";

/** 上游返回的模型条目（标准化后）。 */
export interface UpstreamModelEntry {
  id: string;
  label: string;
}

/** sub2api /v1/models 单条返回结构（仅取需要的字段）。 */
interface RawUpstreamModel {
  id: string;
  display_name?: string;
}

/** 同步结果摘要。 */
export interface SyncResult {
  upstreamTotal: number;
  added: number;
  restored: number; // 之前 isStale，本次上游又出现了
  staled: number; // 上游已消失，标记为失效
}

@Injectable()
export class ModelService {
  private readonly logger = new Logger(ModelService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settingService: SettingService,
  ) {}

  // ── 上游 ────────────────────────────────────────────────────────────────

  /**
   * 实时拉取上游 sub2api 的全量模型列表（管理员用，用于同步）。
   * URL/KEY 来自 SystemSetting（回退 .env）。
   */
  async listUpstream(): Promise<UpstreamModelEntry[]> {
    const baseURL = await this.settingService.getEffectiveValue(
      SETTING_KEYS.SUB2API_BASE_URL,
    );
    const apiKey = await this.settingService.getEffectiveValue(
      SETTING_KEYS.SUB2API_API_KEY,
    );

    if (!baseURL || !apiKey) {
      throw new ServiceUnavailableException(
        "上游渠道未配置，请先在系统设置中填写 sub2api 地址和密钥",
      );
    }

    const url = `${baseURL.replace(/\/$/, "")}/models`;

    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      this.logger.error(`Failed to reach upstream ${url}`, err);
      throw new ServiceUnavailableException(
        "无法连接上游渠道，请检查地址和网络",
      );
    }

    if (!res.ok) {
      this.logger.error(`Upstream /models returned ${res.status}`);
      throw new ServiceUnavailableException(
        `上游返回错误 (${res.status})，请检查密钥是否有效`,
      );
    }

    const json = (await res.json()) as { data?: RawUpstreamModel[] };
    return (json.data ?? [])
      .map((m) => ({ id: m.id, label: m.display_name || m.id }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  // ── 同步 ────────────────────────────────────────────────────────────────

  /**
   * 同步上游模型到平台白名单表。
   * - 上游新增 → 入库，enabled=false（需管理员手动启用，避免误开放图像/preview 模型）
   * - 上游仍在 → 刷新 lastSeenAt，若曾标记 isStale 则恢复
   * - 上游消失 → 标记 isStale（不物理删除，保留历史会话可读）
   */
  async syncFromUpstream(): Promise<SyncResult> {
    const upstream = await this.listUpstream();
    const upstreamIds = new Set(upstream.map((m) => m.id));
    const now = new Date();

    const existing = await this.prisma.platformModel.findMany();
    const existingByModelId = new Map(existing.map((m) => [m.modelId, m]));

    let added = 0;
    let restored = 0;

    for (const m of upstream) {
      const found = existingByModelId.get(m.id);
      if (!found) {
        await this.prisma.platformModel.create({
          data: {
            modelId: m.id,
            label: m.label,
            enabled: false,
            lastSeenAt: now,
          },
        });
        added++;
      } else {
        if (found.isStale) restored++;
        await this.prisma.platformModel.update({
          where: { id: found.id },
          data: { lastSeenAt: now, isStale: false },
        });
      }
    }

    // 上游已消失的：标记失效，不删除
    const staleTargets = existing.filter(
      (m) => !upstreamIds.has(m.modelId) && !m.isStale,
    );
    if (staleTargets.length > 0) {
      await this.prisma.platformModel.updateMany({
        where: { id: { in: staleTargets.map((m) => m.id) } },
        data: { isStale: true },
      });
    }

    const result: SyncResult = {
      upstreamTotal: upstream.length,
      added,
      restored,
      staled: staleTargets.length,
    };
    this.logger.log(`Model sync done: ${JSON.stringify(result)}`);
    return result;
  }

  // ── 查询 ────────────────────────────────────────────────────────────────

  /**
   * 管理端：列出平台全部模型（含禁用与失效）。
   * 附带 hasPricing 标记 —— 未配价的模型启用后按保底价计费，
   * 前端据此显示警示，提醒尽快在 MODEL_PRICING 补上真实价格。
   */
  async listAll() {
    const rows = await this.prisma.platformModel.findMany({
      orderBy: [{ sortOrder: "asc" }, { modelId: "asc" }],
    });
    return rows.map((r) => ({ ...r, hasPricing: hasPricing(r.modelId) }));
  }

  /**
   * 用户端：仅返回已启用且未失效的模型。
   * 用于员工表单的模型选择、会话内模型切换。
   */
  async listEnabled(): Promise<UpstreamModelEntry[]> {
    const rows = await this.prisma.platformModel.findMany({
      where: { enabled: true, isStale: false },
      orderBy: [{ sortOrder: "asc" }, { modelId: "asc" }],
      select: { modelId: true, label: true },
    });
    return rows.map((r) => ({ id: r.modelId, label: r.label }));
  }

  /** 校验某模型 ID 是否已对用户开放（切换模型时用）。 */
  async isEnabled(modelId: string): Promise<boolean> {
    const row = await this.prisma.platformModel.findUnique({
      where: { modelId },
      select: { enabled: true, isStale: true },
    });
    return !!row && row.enabled && !row.isStale;
  }

  // ── 修改 ────────────────────────────────────────────────────────────────

  /** 管理端：更新单个模型（启用状态 / 显示名 / 排序）。 */
  async updateModel(
    id: string,
    data: { enabled?: boolean; label?: string; sortOrder?: number },
  ) {
    const found = await this.prisma.platformModel.findUnique({ where: { id } });
    if (!found) throw new NotFoundException(`Model ${id} not found`);

    const updated = await this.prisma.platformModel.update({
      where: { id },
      data: {
        ...(data.enabled !== undefined && { enabled: data.enabled }),
        ...(data.label !== undefined && { label: data.label }),
        ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
      },
    });
    // 与 listAll 保持同样的返回结构，避免前端 PlatformModel 类型与实际响应不一致
    return { ...updated, hasPricing: hasPricing(updated.modelId) };
  }
}
