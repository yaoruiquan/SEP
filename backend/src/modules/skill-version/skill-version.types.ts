export type SkillVersionScope = 'PLATFORM' | 'ENTERPRISE';
export type SkillVersionStatus =
  | 'DRAFT'
  | 'PENDING_ENTERPRISE_REVIEW'
  | 'ENTERPRISE_APPROVED'
  | 'PENDING_PLATFORM_REVIEW'
  | 'PLATFORM_APPROVED'
  | 'ENTERPRISE_REJECTED'
  | 'PLATFORM_REJECTED'
  | 'ARCHIVED';

export interface SkillVersionSummary {
  id: string;
  capabilityId: string;
  version: string;
  scope: SkillVersionScope;
  status: SkillVersionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface SkillVersionWithContent extends SkillVersionSummary {
  content: string;
  changeSummary: string | null;
  enterpriseId: string | null;
  parentVersionId: string | null;
  sourceVersionId: string | null;
  capability: {
    id: string;
    name: string;
    type: string;
    description: string;
  };
}

export interface CapabilitySkillVersionItem {
  capabilityId: string;
  capabilityName: string;
  capabilityType: string;
  status: string;
  selectedVersionId: string | null;
  selectedVersion: SkillVersionSummary | null;
  platformDefaultVersionId: string | null;
  platformDefaultVersion: SkillVersionSummary | null;
  availableVersions: SkillVersionSummary[];
}

export interface EmployeeSkillsResponse {
  employeeId: string;
  employeeName: string;
  selectedVersionsByCapability: CapabilitySkillVersionItem[];
}
