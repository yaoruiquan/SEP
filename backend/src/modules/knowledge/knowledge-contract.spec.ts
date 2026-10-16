import { KnowledgeBaseCreateDtoSchema, KnowledgeBaseUpdateDtoSchema, KnowledgeMemberGrantCreateDtoSchema,
  KnowledgePageQuerySchema, KnowledgeMemberSearchDtoSchema } from 'shared';

describe('Knowledge strict request contracts', () => {
  it('enforces the client contract name 80 and description 1000 limits on create/update', () => {
    for (const schema of [KnowledgeBaseCreateDtoSchema, KnowledgeBaseUpdateDtoSchema]) {
      expect(schema.safeParse({ name: '名'.repeat(80), description: '述'.repeat(1000) }).success).toBe(true);
      expect(schema.safeParse({ name: '名'.repeat(81) }).success).toBe(false);
      expect(schema.safeParse({ name: '知识库', description: '述'.repeat(1001) }).success).toBe(false);
    }
  });
  it('rejects legacy subscription/department grant payloads and duplicate members', () => {
    expect(KnowledgeMemberGrantCreateDtoSchema.safeParse({ subscriptionId: 'sub-a' }).success).toBe(false);
    expect(KnowledgeMemberGrantCreateDtoSchema.safeParse({ memberIds: ['m-a', 'm-a'] }).success).toBe(false);
    expect(KnowledgeMemberGrantCreateDtoSchema.safeParse({ memberIds: ['m-a'], permission: 'admin' }).success).toBe(false);
  });
  it('rejects empty updates and unknown fields rather than silently stripping them', () => {
    expect(KnowledgeBaseUpdateDtoSchema.safeParse({}).success).toBe(false);
    expect(KnowledgeBaseUpdateDtoSchema.safeParse({ description: null }).success).toBe(false);
    expect(KnowledgeBaseUpdateDtoSchema.safeParse({ name: 'new', enterpriseId: 'ent-b' }).success).toBe(false);
  });
  it('enforces bounded pagination and defaults', () => {
    expect(KnowledgePageQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
    for (const page of ['0', '-1', '1.2', '', 'Infinity']) {
      expect(KnowledgePageQuerySchema.safeParse({ page }).success).toBe(false);
    }
    expect(KnowledgePageQuerySchema.safeParse({ pageSize: '101' }).success).toBe(false);
  });
  it('accepts member search only, not subscription-based scopes or client strategies', () => {
    expect(KnowledgeMemberSearchDtoSchema.parse({ query: '  policy  ' })).toEqual({ query: 'policy', topK: 5 });
    expect(KnowledgeMemberSearchDtoSchema.safeParse({ query: 'q', knowledgeBaseIds: [] }).success).toBe(false);
    expect(KnowledgeMemberSearchDtoSchema.safeParse({ query: 'q', subscriptionId: 's' }).success).toBe(false);
  });
});
