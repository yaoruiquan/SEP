import {
  AdoptPersonalVersionsDtoSchema,
  PersonalSkillDiffQuerySchema,
  ReviewSkillVersionDtoSchema,
  SelectPersonalSkillVersionDtoSchema,
  SelectSkillVersionDtoSchema,
  SubmitPersonalSkillVersionDtoSchema,
} from './skill-version.dto';

describe('Unified enterprise skill review DTOs', () => {
  it('requires a rejection reason and trims it', () => {
    for (const comment of [undefined, '', '   ']) {
      expect(ReviewSkillVersionDtoSchema.safeParse({ decision: 'REJECT', comment }).success).toBe(false);
    }
    expect(ReviewSkillVersionDtoSchema.parse({ decision: 'REJECT', comment: ' reason ' }).comment).toBe('reason');
    expect(ReviewSkillVersionDtoSchema.safeParse({ decision: 'APPROVE' }).success).toBe(true);
  });

  it('validates the optional preview revision as an offset-aware timestamp', () => {
    for (const expectedUpdatedAt of ['2026-10-09T08:00:00.123Z', '2026-10-09T16:00:00+08:00']) {
      expect(ReviewSkillVersionDtoSchema.parse({ decision: 'APPROVE', expectedUpdatedAt }).expectedUpdatedAt)
        .toBe(expectedUpdatedAt);
    }
    expect(ReviewSkillVersionDtoSchema.safeParse({ decision: 'APPROVE', expectedUpdatedAt: 'yesterday' }).success).toBe(false);
  });

  it('keeps explicit FOLLOW separate from selecting a specific version', () => {
    expect(SelectPersonalSkillVersionDtoSchema.parse({ versionId: null })).toEqual({ versionId: null });
    expect(SelectPersonalSkillVersionDtoSchema.parse({ versionId: 'personal-version' })).toEqual({ versionId: 'personal-version' });
    for (const body of [{}, { versionId: '' }]) {
      expect(SelectPersonalSkillVersionDtoSchema.safeParse(body).success).toBe(false);
    }
    expect(SelectSkillVersionDtoSchema.safeParse({ versionId: null }).success).toBe(false);
    expect(SelectSkillVersionDtoSchema.safeParse({ versionId: 'historic-enterprise-version' }).success).toBe(true);
  });

  it('allows all-status paginated diffs and bounds their page size', () => {
    expect(PersonalSkillDiffQuerySchema.parse({})).toEqual({ page: 1, limit: 20 });
    expect(PersonalSkillDiffQuerySchema.parse({ status: 'ENTERPRISE_REJECTED', page: '2', limit: '100' }))
      .toEqual({ status: 'ENTERPRISE_REJECTED', page: 2, limit: 100 });
    for (const body of [{ page: 0 }, { limit: 101 }, { status: 'PERSONAL_ACTIVE' }]) {
      expect(PersonalSkillDiffQuerySchema.safeParse(body).success).toBe(false);
    }
  });

  it('validates batch revisions and the administrator-confirmed merged body', () => {
    const dto = {
      sourceVersionIds: ['source-1', 'source-2'],
      expectedVersions: { 'source-1': '2026-10-09T08:00:00Z' },
      expectedMergedContent: '---\nname: merged\n---\n# Skill\n',
    };
    expect(AdoptPersonalVersionsDtoSchema.parse(dto)).toEqual(dto);
    for (const body of [
      { ...dto, expectedVersions: { 'source-1': 'invalid' } },
      { ...dto, expectedMergedContent: '' },
      { ...dto, expectedMergedContent: 'x'.repeat(500_001) },
      { ...dto, sourceVersionIds: Array.from({ length: 51 }, (_, i) => `source-${i}`) },
    ]) expect(AdoptPersonalVersionsDtoSchema.safeParse(body).success).toBe(false);
  });

  it('preserves full submitted content and rejects client-specified ownership or review state', () => {
    const dto = { capabilityId: 'skill', parentVersionId: 'parent', content: '---\nname: skill\n---\n# Body\n' };
    expect(SubmitPersonalSkillVersionDtoSchema.parse(dto)).toEqual(dto);
    for (const field of ['ownerId', 'enterpriseId', 'status', 'enterpriseReviewedById']) {
      expect(SubmitPersonalSkillVersionDtoSchema.safeParse({ ...dto, [field]: 'injected' }).success).toBe(false);
    }
  });
});
