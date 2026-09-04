import type { Prisma } from '@prisma/client';

/**
 * 「把一个企业版本复制成平台版」的唯一写法。
 *
 * 这件事本来有三个发起人，各写了一遍，写法还不一样：
 *   1. 企业管理员在能力迭代页投稿单个版本（`SkillVersionService.submitPlatformReview`）
 *   2. 企业管理员在贡献中心整能力投稿（`CapabilityContributionService.authorizePlatformSubmission`）
 *   3. 运营在版本审核页主动采纳（`SkillVersionService.adoptEnterpriseVersion`）
 *
 * 分歧的代价是真的：路径 2 原来不复制、直接把 `scope=ENTERPRISE` 那行的状态改成
 * `PENDING_PLATFORM_REVIEW`，于是运营列表里出现一批点了必然 404 的待审行
 * （`reviewPlatformVersion` 只认 `scope=PLATFORM`），审完还会留下
 * 「`MARKET_PUBLIC` 的能力一个平台版本都没有」的能力。路径 1 又漏了包字段，
 * 平台版拿不到可下载的原始 zip。所以字段拼装收敛到这一个函数。
 */

/** 复制平台版需要读的字段。用常量而不是各自写 select，防止调用方漏字段。 */
export const PLATFORM_PROMOTION_SOURCE_SELECT = {
  id: true,
  capabilityId: true,
  version: true,
  content: true,
  changeSummary: true,
  status: true,
  parentVersionId: true,
  packageKey: true,
  packageSha256: true,
  packageFileCount: true,
  packageFilename: true,
} as const;

export interface PlatformPromotionSource {
  id: string;
  capabilityId: string;
  version: string;
  content: string;
  changeSummary: string | null;
  parentVersionId: string | null;
  packageKey: string | null;
  packageSha256: string | null;
  packageFileCount: number | null;
  packageFilename: string | null;
}

export interface PlatformPromotionArgs {
  source: PlatformPromotionSource;
  /** 平台谱系下的新版本号，由调用方按 `scope=PLATFORM` 的兄弟版本算出 */
  version: string;
  /**
   * 平台谱系上的父版本 = 当前最新的已发布平台版。
   *
   * 不用企业版的父版本：来源已经由 `sourceVersionId` 记着，`parentVersionId` 要能
   * 连出平台自己的时间线。平台上还没有任何版本时退回企业版的父版本。
   */
  platformParentId: string | null;
  status: 'PENDING_PLATFORM_REVIEW' | 'PLATFORM_APPROVED';
  actorId: string;
  changeSummary: string;
  now: Date;
}

export function buildPlatformPromotion(
  args: PlatformPromotionArgs,
): Prisma.SkillVersionUncheckedCreateInput {
  const { source, status, actorId, now } = args;
  const approved = status === 'PLATFORM_APPROVED';
  return {
    capabilityId: source.capabilityId,
    scope: 'PLATFORM',
    // 唯一索引：同一个企业版本只能被收录一次。投稿过的版本运营再点采纳会撞在这里，
    // 平台侧不会出现同一份正文进两遍。
    sourceVersionId: source.id,
    parentVersionId: args.platformParentId ?? source.parentVersionId,
    version: args.version,
    content: source.content,
    changeSummary: args.changeSummary,
    status,
    submittedAt: now,
    createdById: actorId,
    // 包是内容寻址的（同一份包只落一次盘），多个版本指向同一个 key 是设计内的，
    // 所以正文过来时可下载产物要一起过来。
    packageKey: source.packageKey,
    packageSha256: source.packageSha256,
    packageFileCount: source.packageFileCount,
    packageFilename: source.packageFilename,
    ...(approved ? { platformReviewedById: actorId, platformReviewedAt: now } : {}),
  };
}

/**
 * 采纳/投稿的默认变更说明。
 *
 * 平台版的列表里只看得到 changeSummary，如果直接沿用企业版那句「基于 v1.0.0 创建」，
 * 运营三个月后完全说不出这一版是从哪家企业收来的。
 */
export function platformPromotionSummary(args: {
  enterpriseName: string | null;
  sourceVersion: string;
  sourceSummary: string | null;
  override?: string;
}) {
  const override = args.override?.trim();
  if (override) return override;
  const origin = `平台采纳 ${args.enterpriseName ?? '企业'} 的 v${args.sourceVersion}`;
  return args.sourceSummary ? `${origin} —— ${args.sourceSummary}` : origin;
}
