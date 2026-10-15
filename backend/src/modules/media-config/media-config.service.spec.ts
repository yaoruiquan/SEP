import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { MediaConfigService } from './media-config.service';
import { Prisma } from '@prisma/client';
import { CreateMediaProfileDtoSchema, MediaRuntimeSchema, SETTING_KEYS } from 'shared';

function fixture(config?: any) {
  const row = {
    id: 'row-1', profileId: 'product-image', kind: 'image', displayName: '商品图片',
    modelId: 'private-model-id', configVersion: 'cfg_1', operations: ['generate', 'edit'],
    executionMode: 'sync-response', enabled: true, verified: true,
    capabilities: { supportsReferenceImage: true, maxOutputs: 4, sizes: ['1024x1024', '2048x2048'] },
  };
  const prisma: any = {
    mediaModelProfile: {
      findMany: jest.fn().mockResolvedValue([row]),
      findUnique: jest.fn().mockResolvedValue(row),
      create: jest.fn().mockImplementation(async ({ data }) => ({ ...row, ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    enterpriseModelConfig: {
      findUnique: jest.fn().mockResolvedValue({ mediaPolicy: {
        enabledProfileIds: ['product-image'], defaultProfileId: 'product-image',
        allowedOperations: ['generate'], maxOutputs: 2, maxWidth: 1024, maxHeight: 1024,
      } }),
      upsert: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((fn) => fn(prisma));
  const settings: any = {
    getEffectiveValue: jest.fn(async (key) => key === SETTING_KEYS.MEDIA_BASE_URL ? 'https://relay.example/v1' : 'test-secret'),
    updateMediaConnection: jest.fn(),
  };
  const context: any = {
    resolve: jest.fn().mockResolvedValue({ enterpriseId: 'ent-1', role: 'ENTERPRISE_ADMIN' }),
    assertEnterpriseAdmin: jest.fn(),
  };
  return { service: new MediaConfigService(prisma, settings, context, config), prisma, settings, context, row };
}

describe('MediaConfigService', () => {
  it('creates an unverified profile with a server-owned version', async () => {
    const { service, prisma } = fixture();
    const dto = CreateMediaProfileDtoSchema.parse({
      profileId: 'new-image', kind: 'image', displayName: '图片', modelId: 'test-model',
      operations: ['generate'], executionMode: 'sync-response', capabilities: { sizes: ['1024x1024'] },
    });
    const result = await service.createProfile(dto);
    expect(result).toMatchObject({ verified: false, enabled: false, configVersion: expect.stringMatching(/^cfg_/) });
    expect(prisma.mediaModelProfile.create.mock.calls[0][0].data).not.toHaveProperty('apiKey');
  });

  it('rejects stale versions before writing and detects concurrent CAS failure', async () => {
    const { service, prisma } = fixture();
    await expect(service.updateProfile('product-image', { enabled: false, expectedConfigVersion: 'stale' })).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.mediaModelProfile.updateMany).not.toHaveBeenCalled();
    prisma.mediaModelProfile.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.updateProfile('product-image', { enabled: false, expectedConfigVersion: 'cfg_1' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('keeps verification for display-only changes but revokes it for model changes', async () => {
    const { service, prisma } = fixture();
    await service.updateProfile('product-image', { displayName: '新名称', expectedConfigVersion: 'cfg_1' });
    expect(prisma.mediaModelProfile.updateMany.mock.calls[0][0]).toMatchObject({
      where: { profileId: 'product-image', configVersion: 'cfg_1' }, data: { verified: true },
    });
    await service.updateProfile('product-image', { modelId: 'changed-model', expectedConfigVersion: 'cfg_1' });
    expect(prisma.mediaModelProfile.updateMany.mock.calls[1][0].data.verified).toBe(false);
  });

  it('does not churn versions for unchanged profiles and rejects invalid capability combinations', async () => {
    const { service, prisma } = fixture();
    await service.updateProfile('product-image', { enabled: true, expectedConfigVersion: 'cfg_1' });
    expect(prisma.mediaModelProfile.updateMany).not.toHaveBeenCalled();
    await expect(service.updateProfile('product-image', {
      expectedConfigVersion: 'cfg_1', capabilities: { supportsReferenceImage: false },
    })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.updateProfile('product-image', {
      expectedConfigVersion: 'cfg_1', capabilities: { sizes: [] },
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns Nest errors for missing or invalid stored profiles', async () => {
    const { service, prisma, row } = fixture();
    prisma.mediaModelProfile.findUnique.mockResolvedValue(null);
    await expect(service.updateProfile('missing', { enabled: true, expectedConfigVersion: 'cfg_1' })).rejects.toBeInstanceOf(NotFoundException);
    prisma.mediaModelProfile.findMany.mockResolvedValue([{ ...row, capabilities: {} }]);
    await expect(service.listProfiles()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('returns connection state without exposing the secret', async () => {
    const { service } = fixture();
    const result = await service.getConnection();
    expect(result).toEqual({ configured: true, baseUrl: 'https://relay.example/v1', apiKeyConfigured: true });
    expect(JSON.stringify(result)).not.toContain('test-secret');
  });

  it('requires enterprise context even for the available profile list', async () => {
    const { service, context, prisma } = fixture();
    context.resolve.mockRejectedValue(new ForbiddenException());
    await expect(service.getAvailableProfiles('outsider')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.mediaModelProfile.findMany).not.toHaveBeenCalled();
  });

  it('omits the upstream model ID from enterprise available profiles', async () => {
    const { service, context } = fixture();
    const profiles = await service.getAvailableProfiles('member');
    expect(context.resolve).toHaveBeenCalledWith('member');
    expect(profiles[0]).not.toHaveProperty('modelId');
    expect(profiles[0]).toMatchObject({ profileId: 'product-image', enabled: true, verified: true });
  });

  it('restricts policy updates to enterprise admins', async () => {
    const { service, context, prisma } = fixture();
    context.assertEnterpriseAdmin.mockImplementation(() => { throw new ForbiddenException(); });
    await expect(service.updateEnterpriseConfig('member', { maxOutputs: 1 })).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.enterpriseModelConfig.upsert).not.toHaveBeenCalled();
  });

  it('rejects unverified allowlist entries and defaults outside the allowlist', async () => {
    const { service, prisma } = fixture();
    await expect(service.updateEnterpriseConfig('admin', { enabledProfileIds: ['unknown'] })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.updateEnterpriseConfig('admin', { defaultProfileId: 'unknown' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.enterpriseModelConfig.upsert).not.toHaveBeenCalled();
  });

  it('stores only media policy, without modifying chat configuration', async () => {
    const { service, prisma } = fixture();
    await service.updateEnterpriseConfig('admin', { maxOutputs: 1 });
    expect(prisma.enterpriseModelConfig.upsert.mock.calls[0][0]).toMatchObject({
      where: { enterpriseId: 'ent-1' }, update: { mediaPolicy: { maxOutputs: 1 } },
    });
    expect(Object.keys(prisma.enterpriseModelConfig.upsert.mock.calls[0][0].update)).toEqual(['mediaPolicy']);
  });

  it('maps concurrent policy transaction conflicts to HTTP 409', async () => {
    const { service, prisma } = fixture();
    prisma.$transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('write conflict', {
      code: 'P2034', clientVersion: 'test',
    }));
    await expect(service.updateEnterpriseConfig('admin', { maxOutputs: 1 })).rejects.toBeInstanceOf(ConflictException);
  });

  it('intersects enterprise limits without advertising executable tools or secrets', async () => {
    const { service, prisma } = fixture();
    const runtime = await service.getRuntimeMedia('ent-1');
    expect(MediaRuntimeSchema.safeParse(runtime).success).toBe(true);
    expect(runtime).toMatchObject({ protocolVersion: 1, executionAvailable: false, tools: [], defaultProfileId: 'product-image',
      profiles: [{ operations: ['generate'], capabilities: { maxOutputs: 2, sizes: ['1024x1024'] } }] });
    expect(prisma.mediaModelProfile.findMany.mock.calls[0][0].where).toEqual({ kind: 'image', enabled: true, verified: true });
    const json = JSON.stringify(runtime);
    for (const secret of ['private-model-id', 'test-secret', 'relay.example']) expect(json).not.toContain(secret);
  });

  it('fails closed on malformed policy, missing connection and ineffective limits', async () => {
    const { service, prisma, settings } = fixture();
    prisma.enterpriseModelConfig.findUnique.mockResolvedValue({ mediaPolicy: { maxOutputs: -1 } });
    expect((await service.getRuntimeMedia('ent-1')).profiles).toEqual([]);
    prisma.enterpriseModelConfig.findUnique.mockResolvedValue({ mediaPolicy: { enabledProfileIds: ['product-image'], defaultProfileId: 'product-image', maxWidth: 1 } });
    expect(await service.getRuntimeMedia('ent-1')).toMatchObject({ profiles: [], defaultProfileId: null });
    settings.getEffectiveValue.mockResolvedValue(undefined);
    expect((await service.getRuntimeMedia('ent-1')).profiles).toEqual([]);
  });

  it('enables only real-compatible profiles when the exact switch and usable HTTPS connection are present', async () => {
    const config = { get: jest.fn(() => 'true') };
    const { service, prisma, row } = fixture(config);
    row.modelId = 'gpt-image-2';
    row.capabilities = {
      supportsReferenceImage: true, maxOutputs: 8,
      sizes: ['1024x1024', '1536x1024', '1024x1536', '2048x2048'],
    };
    prisma.enterpriseModelConfig.findUnique.mockResolvedValue({ mediaPolicy: {
      enabledProfileIds: ['product-image'], defaultProfileId: 'product-image',
      allowedOperations: ['generate', 'edit'], maxOutputs: 8, maxWidth: 1536, maxHeight: 1536,
    } });

    const runtime = await service.getRuntimeMedia('ent-1');
    expect(MediaRuntimeSchema.safeParse(runtime).success).toBe(true);
    expect(runtime).toMatchObject({
      executionAvailable: true, tools: ['image_generate', 'image_edit'], defaultProfileId: 'product-image',
      profiles: [{ operations: ['generate', 'edit'], capabilities: {
        maxOutputs: 4, sizes: ['1024x1024', '1536x1024', '1024x1536'],
      } }],
    });
    const json = JSON.stringify(runtime);
    for (const secret of ['gpt-image-2', 'test-secret', 'relay.example']) expect(json).not.toContain(secret);
  });

  it('keeps execution closed unless the real switch is exactly true', async () => {
    const config = { get: jest.fn(() => 'TRUE') };
    const { service, row } = fixture(config);
    row.modelId = 'gpt-image-2';

    expect(await service.getRuntimeMedia('ent-1')).toMatchObject({ executionAvailable: false, tools: [] });
  });

  it('fails closed for unusable real connection or profiles outside the real execution contract', async () => {
    const config = { get: jest.fn(() => 'true') };
    const { service, settings, prisma, row } = fixture(config);
    row.modelId = 'gpt-image-2';
    settings.getEffectiveValue.mockImplementation(async (key: string) =>
      key === SETTING_KEYS.MEDIA_BASE_URL ? 'http://relay.example/v1' : 'test-secret');
    expect(await service.getRuntimeMedia('ent-1')).toMatchObject({ executionAvailable: false, tools: [] });

    settings.getEffectiveValue.mockImplementation(async (key: string) =>
      key === SETTING_KEYS.MEDIA_BASE_URL ? 'https://relay.example/v1' : 'test-secret');
    row.modelId = 'private-model-id';
    expect(await service.getRuntimeMedia('ent-1')).toMatchObject({ executionAvailable: false, tools: [], profiles: [] });
    row.modelId = 'gpt-image-2';
    row.executionMode = 'async-query';
    expect(await service.getRuntimeMedia('ent-1')).toMatchObject({ executionAvailable: false, tools: [], profiles: [] });

    row.executionMode = 'sync-response';
    prisma.mediaModelProfile.findMany.mockResolvedValue([]);
    expect(await service.getRuntimeMedia('ent-1')).toMatchObject({ executionAvailable: false, tools: [], profiles: [] });
  });
});
