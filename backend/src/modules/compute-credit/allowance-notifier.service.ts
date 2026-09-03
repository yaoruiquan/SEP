import { Injectable, Logger } from "@nestjs/common";
import { Decimal } from "@prisma/client/runtime/library";
import { PrismaService } from "../../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { SettingService } from "../setting/setting.service";
import { SETTING_KEYS, parseCnyAmount } from "shared";
import {
  currentPeriodLabel,
  formatBusinessDateTime,
  resolvePeriodWindow,
} from "./allowance-period";
import { MemberAllowanceQueryService } from "./member-allowance-query.service";
import type { MemberAllowanceView } from "./member-allowance.types";

/** 用到多少算「即将用完」。留出反应时间，又不至于让人天天收通知。 */
const WARNING_RATIO = 0.8;

/** 低余额阈值未配置时的兜底（元），与运营端该配置项的 placeholder 一致。 */
const DEFAULT_LOW_BALANCE_THRESHOLD_CNY = 10;

/** 额度通知的两种档位。 */
type AllowanceNotifyKind = "WARNING" | "EXHAUSTED";

/**
 * 一次扣费之后、判定要不要发通知所需的全部输入。
 *
 * 全部来自扣费事务内**已经读出来的**数字（闸门的 `AllowanceChargePlan` + 这一笔的
 * 扣费结果），所以「要不要发」这一步不打库。
 */
export interface AllowanceNotifyInput {
  enterpriseId: string;
  userId?: string | null;
  /** 闸门解析出的周期窗口；null = 该成员不限额，没有闸门也就没有额度通知 */
  windowId: string | null;
  /** 本周期上限；null = 不限额 */
  limitCNY: Decimal | null;
  /** 上一周期结转进来的额度 */
  carriedInCNY: Decimal;
  /** 扣费**前**还能动用的企业资金（常规 + 追加）；null = 不限额 */
  availableBeforeCNY: Decimal | null;
  /** 扣费**前**的常规额度余量（不含追加） */
  regularRemainingBeforeCNY: Decimal;
  /** 这一笔记到额度上的企业资金：credit + 企业钱包 + 欠费，与闸门「已用」同口径 */
  enterpriseUsedDeltaCNY: Decimal;
  /** 这一笔从企业钱包扣走多少 —— 只有它 > 0 才值得回头看钱包余额 */
  walletPaidCNY: Decimal;
}

/**
 * 额度类通知：额度即将用完 / 额度已用尽 / 企业钱包余额偏低。
 *
 * 三条都挂在扣费之后，且**都不在扣费事务里** —— 通知写失败绝不能让一笔已经发生的
 * 模型调用回滚，持锁时间也不该为了发通知变长。
 *
 * 判定刻意分两级，因为这段代码每轮对话都要跑一次：
 *   1. 先用闸门**已经读出来的**数字做纯算术判定，一次库都不打（绝大多数对话止步于此）
 *   2. 真越线了，才去查收件人、查重、并按库里的权威数字复核一遍
 * 反过来写（先查库再判断）等于给每条消息凭空加四五次查询。
 *
 * 查重以**周期窗口 id** 为业务键：同一个人同一个周期，「即将用完」和「已用尽」
 * 各只发一次。少了这层，成员一超线就会每说一句话收到一条通知 ——
 * 通知中心当场变成垃圾场，真正要紧的那条反而被淹掉。
 */
@Injectable()
export class AllowanceNotifierService {
  private readonly logger = new Logger(AllowanceNotifierService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingService,
    private readonly query: MemberAllowanceQueryService,
  ) {}

  /**
   * 扣费落账之后调用。**永不抛异常** —— 钱已经扣了、账单已经落了，
   * 通知发不出去是运维问题，不该反过来把一次成功的对话变成 500。
   */
  async afterCharge(input: AllowanceNotifyInput): Promise<void> {
    await Promise.all([
      this.notifyAllowance(input).catch((error) =>
        this.logFailure("额度通知", error),
      ),
      this.notifyWalletLowBalance(input).catch((error) =>
        this.logFailure("钱包低余额通知", error),
      ),
    ]);
  }

  // ── 额度：即将用完 / 已用尽 ─────────────────────────────────────────────────

  private async notifyAllowance(input: AllowanceNotifyInput): Promise<void> {
    const { enterpriseId, userId, windowId } = input;
    if (!userId || !windowId || !input.limitCNY) return;

    const kind = this.classify(input);
    if (!kind) return;

    // 成员一条、管理员各一条（方案 §5.8）。成员自己就是管理员时只发成员那条，
    // 否则他会收到两条讲同一件事、口吻还不一样的通知。
    const admins = await this.loadAdmins(enterpriseId, userId);
    const sent = await this.loadSentKinds(windowId, [userId, ...admins]);
    const pending = [userId, ...admins].filter(
      (id) => !this.alreadyCovered(kind, sent.get(id)),
    );
    if (pending.length === 0) return;

    // 判定用的是扣费时的快照，发信前按库里的权威数字复核一遍：这中间可能有并发扣费，
    // 也可能管理员刚刚调高了上限 —— 那就不该再发「已用尽」。
    const view = await this.query.getOne(enterpriseId, userId);
    if (!this.stillHolds(kind, view)) return;

    const text = this.buildAllowanceText(kind, view);
    if (pending.includes(userId)) {
      await this.notifications.create({
        userId,
        type:
          kind === "EXHAUSTED" ? "ALLOWANCE_EXHAUSTED" : "ALLOWANCE_WARNING",
        title: text.member.title,
        message: text.member.message,
        relatedType: "allowance",
        relatedId: windowId,
      });
    }
    const adminTargets = pending.filter((id) => id !== userId);
    if (adminTargets.length > 0) {
      await this.notifications.createBatch(adminTargets, {
        type:
          kind === "EXHAUSTED" ? "ALLOWANCE_EXHAUSTED" : "ALLOWANCE_WARNING",
        title: text.admin.title,
        message: text.admin.message,
        relatedType: "allowance",
        relatedId: windowId,
      });
    }
  }

  /**
   * 这一笔扣完之后到了哪个档位。纯算术，不打库。
   *
   * 「已用尽」看的是**常规 + 追加**的合计余量（那才是企业资金真正的闸门），
   * 「即将用完」的百分比只对着**常规预算**算 —— 追加额度是临时补给，
   * 拿它去稀释告警线，会让「加了一次追加额度就再也不报警」成为常态。
   */
  private classify(input: AllowanceNotifyInput): AllowanceNotifyKind | null {
    const availableAfter = input.availableBeforeCNY?.sub(
      input.enterpriseUsedDeltaCNY,
    );
    if (availableAfter && availableAfter.lessThanOrEqualTo(0)) {
      return "EXHAUSTED";
    }

    const regularBudget = input.limitCNY!.add(input.carriedInCNY);
    if (regularBudget.lessThanOrEqualTo(0)) return null;
    // 常规余量已经见底（超出部分正在吃追加额度）：百分比必然过线，不必再算
    if (input.regularRemainingBeforeCNY.lessThanOrEqualTo(0)) return "WARNING";

    const usedAfter = regularBudget
      .sub(input.regularRemainingBeforeCNY)
      .add(input.enterpriseUsedDeltaCNY);
    return usedAfter.div(regularBudget).greaterThanOrEqualTo(WARNING_RATIO)
      ? "WARNING"
      : null;
  }

  /** 库里的数字是否仍然支持这条通知。口径与管理端面板完全一致（同一个 view）。 */
  private stillHolds(
    kind: AllowanceNotifyKind,
    view: MemberAllowanceView,
  ): boolean {
    if (view.limitCNY === null) return false;
    if (kind === "EXHAUSTED") {
      return (
        view.totalRemainingCNY !== null && Number(view.totalRemainingCNY) <= 0
      );
    }
    return view.usedPct !== null && view.usedPct >= WARNING_RATIO * 100;
  }

  /**
   * 已经发过的档位。`EXHAUSTED` 覆盖 `WARNING` ——
   * 先报了「已用尽」再补一条「即将用完」是倒退，只会让人以为额度回来了。
   */
  private alreadyCovered(
    kind: AllowanceNotifyKind,
    sentKinds: Set<AllowanceNotifyKind> | undefined,
  ): boolean {
    if (!sentKinds) return false;
    if (sentKinds.has("EXHAUSTED")) return true;
    return kind === "WARNING" && sentKinds.has("WARNING");
  }

  private async loadSentKinds(
    windowId: string,
    userIds: readonly string[],
  ): Promise<Map<string, Set<AllowanceNotifyKind>>> {
    const rows = await this.prisma.notification.findMany({
      // userId 在前：Notification 只有 userId 前缀索引，
      // 单靠 relatedId 过滤会退化成全表扫
      where: {
        userId: { in: [...userIds] },
        relatedId: windowId,
        type: { in: ["ALLOWANCE_WARNING", "ALLOWANCE_EXHAUSTED"] },
      },
      select: { userId: true, type: true },
    });
    const byUser = new Map<string, Set<AllowanceNotifyKind>>();
    for (const row of rows) {
      const kinds = byUser.get(row.userId) ?? new Set<AllowanceNotifyKind>();
      kinds.add(row.type === "ALLOWANCE_EXHAUSTED" ? "EXHAUSTED" : "WARNING");
      byUser.set(row.userId, kinds);
    }
    return byUser;
  }

  /**
   * 两份文案：给成员的和给管理员的。
   *
   * 「已用尽」那条**必须带重置时间和两个出路**（找管理员 / 个人充值）——
   * 只说「不能用了」的通知，收件人下一步只能来问客服。措辞与对话前闸门
   * （`MemberAllowanceService.check`）保持一致：同一件事在弹窗和通知里
   * 换个说法，会让人以为是两个不同的问题。
   */
  private buildAllowanceText(
    kind: AllowanceNotifyKind,
    view: MemberAllowanceView,
  ): {
    member: { title: string; message: string };
    admin: { title: string; message: string };
  } {
    const scope = currentPeriodLabel(view.period);
    const resetAt = formatBusinessDateTime(new Date(view.resetAt));
    const budget =
      Number(view.carriedInCNY) > 0
        ? `上限 ¥${yuan(view.limitCNY)} + 结转 ¥${yuan(view.carriedInCNY)}`
        : `上限 ¥${yuan(view.limitCNY)}`;
    const spent = `已用 ¥${yuan(view.usedCNY)} / ${budget}`;
    const topUpNote =
      Number(view.topUpRemainingCNY) > 0
        ? `（另有未用完的追加额度 ¥${yuan(view.topUpRemainingCNY)}）`
        : "";

    if (kind === "EXHAUSTED") {
      return {
        member: {
          title: "算力额度已用尽",
          message:
            `你${scope}的算力额度已用尽（${spent}）。额度将于 ${resetAt} 重置；` +
            `需要提前恢复，可联系企业管理员调高额度或追加一次性额度，` +
            `也可为个人余额充值后自费使用。`,
        },
        admin: {
          title: "成员算力额度已用尽",
          message:
            `${view.name} ${scope}的算力额度已用尽（${spent}），` +
            `他的对话已改为个人自费或暂停。额度将于 ${resetAt} 重置；` +
            `如需立即恢复，可调高上限或追加一次性额度。`,
        },
      };
    }

    return {
      member: {
        title: "算力额度即将用完",
        message:
          `你${scope}的算力额度已用 ${view.usedPct}%（${spent}），` +
          `常规额度剩余 ¥${yuan(view.remainingCNY)}${topUpNote}。` +
          `额度将于 ${resetAt} 重置。`,
      },
      admin: {
        title: "成员算力额度即将用完",
        message:
          `${view.name} ${scope}的算力额度已用 ${view.usedPct}%（${spent}），` +
          `常规额度剩余 ¥${yuan(view.remainingCNY)}${topUpNote}。` +
          `用尽后他的对话将改为个人自费；如需继续由公司承担，可调高上限或追加一次性额度。`,
      },
    };
  }

  // ── 企业钱包余额偏低 ───────────────────────────────────────────────────────

  /**
   * 推给企业管理员。**一天最多一条**：余额偏低是一个持续状态而不是一次事件，
   * 按次发会在余额见底前的几十轮对话里刷出几十条一模一样的通知。
   *
   * 只在这一笔真的动了企业钱包时才去看余额（`walletPaidCNY > 0`）：
   * 没动钱包余额就没变，白查一次库。代价是「订阅扣款把钱包花低、而算力恰好
   * 全由赠送余额覆盖」这段时间里不报警 —— 那段时间钱包低也确实还没影响到谁。
   */
  private async notifyWalletLowBalance(
    input: AllowanceNotifyInput,
  ): Promise<void> {
    if (input.walletPaidCNY.lessThanOrEqualTo(0)) return;

    const threshold = await this.resolveLowBalanceThresholdCNY();
    if (threshold.lessThanOrEqualTo(0)) return; // 显式配 0 = 关掉这条通知

    const wallet = await this.prisma.enterpriseWallet.findUnique({
      where: { enterpriseId: input.enterpriseId },
      select: { balance: true },
    });
    if (!wallet || wallet.balance.greaterThan(threshold)) return;

    const admins = await this.loadAdmins(input.enterpriseId, null);
    if (admins.length === 0) return;

    const since = resolvePeriodWindow("DAY", new Date()).start;
    const already = await this.prisma.notification.findMany({
      where: {
        userId: { in: admins },
        type: "WALLET_LOW_BALANCE",
        relatedId: input.enterpriseId,
        createdAt: { gte: since },
      },
      select: { userId: true },
    });
    const notified = new Set(already.map((row) => row.userId));
    const targets = admins.filter((id) => !notified.has(id));
    if (targets.length === 0) return;

    await this.notifications.createBatch(targets, {
      type: "WALLET_LOW_BALANCE",
      title: "企业钱包余额偏低",
      message:
        `企业钱包余额 ¥${wallet.balance.toFixed(2)}，已低于告警阈值 ` +
        `¥${threshold.toFixed(2)}。余额用尽后成员对话将转为个人自费或计入欠费，` +
        `请及时充值。`,
      relatedType: "wallet",
      relatedId: input.enterpriseId,
    });
  }

  /** 阈值（元）。未配置回落 ¥10（与运营端 placeholder 一致），显式配 0 表示关闭。 */
  private async resolveLowBalanceThresholdCNY(): Promise<Decimal> {
    const raw = await this.settings.getEffectiveValue(
      SETTING_KEYS.LOW_BALANCE_THRESHOLD,
    );
    return new Decimal(parseCnyAmount(raw, DEFAULT_LOW_BALANCE_THRESHOLD_CNY));
  }

  // ── 共用 ───────────────────────────────────────────────────────────────────

  private async loadAdmins(
    enterpriseId: string,
    excludeUserId: string | null,
  ): Promise<string[]> {
    const rows = await this.prisma.enterpriseMember.findMany({
      where: { enterpriseId, role: "ENTERPRISE_ADMIN" },
      select: { userId: true },
    });
    return rows.map((row) => row.userId).filter((id) => id !== excludeUserId);
  }

  private logFailure(what: string, error: unknown): void {
    this.logger.error(
      `${what}发送失败`,
      error instanceof Error ? error.stack : String(error),
    );
  }
}

/** 通知文案统一两位小数：账单精度 6 位，直接印出来会得到「已用 ¥410.0000」。 */
function yuan(raw: string | null): string {
  return Number(raw ?? 0).toFixed(2);
}
