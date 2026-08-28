import { CapabilityType, ContributionPlatformStatus, ContributionReviewStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';

export const CONTRIBUTION_CAPABILITY_SELECT = {
  id: true,
  name: true,
  description: true,
  type: true,
  industry: true,
  position: true,
  status: true,
  enterpriseId: true,
  visibility: true,
  enterpriseReviewStatus: true,
  enterpriseReviewedById: true,
  enterpriseReviewedAt: true,
  enterpriseRejectionReason: true,
  platformReviewStatus: true,
  platformSubmittedById: true,
  platformSubmittedAt: true,
  platformRejectionReason: true,
  validationResult: true,
  validatedAt: true,
  usageCount: true,
  rating: true,
  createdAt: true,
  updatedAt: true,
  contributor: { select: { id: true, name: true, email: true } },
  enterprise: { select: { id: true, name: true } },
  skillConfig: { select: { id: true, modelId: true, temperature: true, maxTokens: true } },
  agentConfig: { select: { id: true, platform: true, botId: true, workflowUrl: true, skillName: true } },
  _count: { select: { skillVersions: true, bindings: true } },
} satisfies Prisma.CapabilitySelect;

export const CONTRIBUTION_PLATFORM_LIST_SELECT = {
  ...CONTRIBUTION_CAPABILITY_SELECT,
  platformSubmittedAt: true,
} as const;

export const CONTRIBUTION_PLATFORM_DETAIL_SELECT = {
  ...CONTRIBUTION_CAPABILITY_SELECT,
  inputSchema: true,
  outputSchema: true,
  skillConfig: { select: { id: true, template: true, modelId: true, temperature: true, maxTokens: true } },
  skillVersions: {
    where: { scope: { in: ['ENTERPRISE', 'PLATFORM'] }, status: { in: ['PENDING_PLATFORM_REVIEW', 'ENTERPRISE_APPROVED', 'PLATFORM_REJECTED', 'PLATFORM_APPROVED'] } },
    select: {
      id: true,
      scope: true,
      version: true,
      content: true,
      changeSummary: true,
      status: true,
      validationResult: true,
      validatedAt: true,
      createdById: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 5,
  },
  enterpriseReviewedBy: { select: { id: true, name: true, email: true } },
  platformSubmittedBy: { select: { id: true, name: true, email: true } },
} satisfies Prisma.CapabilitySelect;

export type ContributionCapabilitySummary = {
  id: string;
  name: string;
  description: string;
  type: CapabilityType;
  industry: string[];
  position: string[];
  status: string;
  enterpriseId: string | null;
  visibility: string;
  enterpriseReviewStatus: ContributionReviewStatus;
  enterpriseReviewedById: string | null;
  enterpriseReviewedAt: Date | null;
  enterpriseRejectionReason: string | null;
  platformReviewStatus: ContributionPlatformStatus;
  platformSubmittedById: string | null;
  platformSubmittedAt: Date | null;
  platformRejectionReason: string | null;
  usageCount: number;
  rating: number | null;
  createdAt: Date;
  updatedAt: Date;
};

/** 作者视角的版本摘要。含包字段，不含正文 —— 正文单独取，列表不需要驼着它。 */
export const AUTHOR_VERSION_SELECT = {
  id: true,
  capabilityId: true,
  scope: true,
  enterpriseId: true,
  parentVersionId: true,
  sourceVersionId: true,
  version: true,
  changeSummary: true,
  status: true,
  packageKey: true,
  packageSha256: true,
  packageFileCount: true,
  packageFilename: true,
  submittedAt: true,
  createdAt: true,
} satisfies Prisma.SkillVersionSelect;

export const USAGE_VERSION_SELECT = {
  id: true,
  scope: true,
  version: true,
  changeSummary: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;
