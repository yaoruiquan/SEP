import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CreateMediaVideoProfileDtoSchema, MediaPolicySchema, MediaRuntimeQuerySchema,
  MediaVideoEnterpriseConfigSchema, MediaVideoModelDiscoverySchema, MediaVideoPolicySchema,
  MediaVideoProfileVerificationSchema, MediaVideoRuntimeSchema, SETTING_KEYS,
  UpdateMediaVideoPolicyDtoSchema, UpdateMediaVideoProfileDtoSchema,
} from 'shared';
import videoFixture from '../../shared/fixtures/media-video-v1.json';
import { MediaConfigService } from './media-config.service';
import { MediaVideoConfigService } from './media-video-config.service';

function setup() {
  const row: any = { ...structuredClone(videoFixture.profile), modelId: 'mock-video-v1', configVersion: 'cfg_video', enabled: true, verified: true };
  const imagePolicy = { enabledProfileIds: ['product-image'], defaultProfileId: 'product-image',
    allowedOperations: ['generate'], maxOutputs: 2, maxWidth: 1024, maxHeight: 1024 };
  const videoPolicy = MediaVideoPolicySchema.parse({ enabledProfileIds: [row.profileId], defaultProfileId: row.profileId });
  let stored: any = { mediaPolicy: { ...imagePolicy, video: videoPolicy } };
  const prisma: any = {
    mediaModelProfile: {
      findMany: jest.fn(async ({ where }) => [row].filter(value => Object.entries(where ?? {}).every(([key, expected]) => value[key] === expected))),
      findUnique: jest.fn(async () => row),
      create: jest.fn(async ({ data }) => ({ ...row, ...data })),
      updateMany: jest.fn(async ({ where, data }) => {
        if (!Object.entries(where).every(([key, expected]) => row[key] === expected)) return { count: 0 };
        Object.assign(row, structuredClone(data));
        return { count: 1 };
      }),
    },
    enterpriseModelConfig: {
      findUnique: jest.fn(async () => stored),
      upsert: jest.fn(async ({ create, update }) => { stored = { ...(stored ?? create), ...update }; return stored; }),
    },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(fn => fn(prisma));
  const context: any = {
    resolve: jest.fn(async () => ({ enterpriseId: 'ent-1', role: 'ENTERPRISE_ADMIN' })),
    assertEnterpriseAdmin: jest.fn(value => { if (value.role !== 'ENTERPRISE_ADMIN') throw new ForbiddenException(); }),
  };
  const config: any = { get: jest.fn(() => 'true') };
  const settings: any = { getEffectiveValue: jest.fn(async key => key === SETTING_KEYS.MEDIA_BASE_URL ? 'https://relay.example/v1' : 'key') };
  return { service: new MediaVideoConfigService(prisma, context, config),
    imageService: new MediaConfigService(prisma, settings, context),
    prisma, context, config, row, imagePolicy, videoPolicy,
    getStored: () => stored, setStored: (value: any) => { stored = value; } };
}

function createInput(overrides: Record<string, unknown> = {}) {
  const { configVersion: _version, verified: _verified, ...profile } = videoFixture.profile;
  return CreateMediaVideoProfileDtoSchema.parse({ ...profile, modelId: 'mock-video-v1', ...overrides });
}

describe('video configuration shared contracts', () => {
  it('keeps image policy defaults and independently nests a disabled video policy', () => {
    expect(MediaPolicySchema.parse({})).not.toHaveProperty('video');
    expect(MediaPolicySchema.parse({ video: {} })).toMatchObject({ enabledProfileIds: [], video: { enabledProfileIds: [], defaultProfileId: null, periodBudget: 0 } });
    expect(UpdateMediaVideoPolicyDtoSchema.parse({ periodBudget: 12 })).toEqual({ periodBudget: 12 });
    expect(UpdateMediaVideoPolicyDtoSchema.parse({})).toEqual({});
  });

  it('strictly rejects image fields, verification injection, vendor parameters, and missing CAS versions', () => {
    for (const extra of [{ verified: true }, { configVersion: 'cfg_x' }, { vendorPayload: {} }, { apiKey: 'secret' }]) {
      expect(CreateMediaVideoProfileDtoSchema.safeParse({ ...createInput(), ...extra }).success).toBe(false);
    }
    expect(CreateMediaVideoProfileDtoSchema.safeParse({ ...createInput(), operations: ['generate'] }).success).toBe(false);
    expect(CreateMediaVideoProfileDtoSchema.safeParse({ ...createInput(), capabilities: { sizes: ['1024x1024'] } }).success).toBe(false);
    expect(UpdateMediaVideoProfileDtoSchema.safeParse({ enabled: true }).success).toBe(false);
    expect(UpdateMediaVideoProfileDtoSchema.safeParse({ expectedConfigVersion: 'cfg_x' }).success).toBe(false);
    expect(UpdateMediaVideoPolicyDtoSchema.safeParse({ enterpriseId: 'other' }).success).toBe(false);
    expect(UpdateMediaVideoPolicyDtoSchema.safeParse({ periodBudget: -1 }).success).toBe(false);
    expect(UpdateMediaVideoPolicyDtoSchema.safeParse({ maxConcurrentJobs: 0 }).success).toBe(false);
  });

  it('negotiates video independently and rejects malformed video queries', () => {
    expect(MediaRuntimeQuerySchema.parse({ videoProtocolVersion: '1' })).toEqual({ videoProtocolVersion: 1 });
    expect(MediaRuntimeQuerySchema.parse({ mediaProtocolVersion: '1', videoProtocolVersion: '2', skillArtifactProtocolVersion: '1' }))
      .toEqual({ mediaProtocolVersion: 1, videoProtocolVersion: 2, skillArtifactProtocolVersion: 1 });
    for (const value of ['', 'bad', '0', '-1', '1.5', ['1', '2'], 'Infinity']) {
      expect(MediaRuntimeQuerySchema.safeParse({ videoProtocolVersion: value }).success).toBe(false);
    }
  });
});

describe('MediaVideoConfigService profiles (mock only)', () => {
  it('filters listing by video and does not feed video rows to the image profile parser', async () => {
    const { service, imageService, prisma } = setup();
    expect(await service.listProfiles()).toHaveLength(1);
    expect(await imageService.listProfiles()).toEqual([]);
    expect(prisma.mediaModelProfile.findMany).toHaveBeenNthCalledWith(1, { where: { kind: 'video' }, orderBy: { createdAt: 'asc' } });
    expect(prisma.mediaModelProfile.findMany).toHaveBeenNthCalledWith(2, { where: { kind: 'image' }, orderBy: { createdAt: 'asc' } });
  });

  it('allows importing arbitrary real models as disabled/unverified without contacting upstream', async () => {
    const { service, prisma } = setup();
    expect(await service.createProfile(createInput({ modelId: 'real-vendor-video' }))).toMatchObject({ modelId: 'real-vendor-video', enabled: false, verified: false, configVersion: expect.stringMatching(/^cfg_/) });
    expect(prisma.mediaModelProfile.create).toHaveBeenCalledTimes(1);
  });

  it('rejects pre-enabled creation and translates duplicate IDs to conflict', async () => {
    const { service, prisma } = setup();
    await expect(service.createProfile(createInput({ enabled: true }))).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.mediaModelProfile.create).not.toHaveBeenCalled();
    prisma.mediaModelProfile.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: 'test' }));
    await expect(service.createProfile(createInput())).rejects.toBeInstanceOf(ConflictException);
  });

  it('verifies only configuration, rotates CAS version, and explicitly disclaims execution', async () => {
    const { service, row } = setup();
    row.enabled = false; row.verified = false;
    const result = await service.verifyProfile(row.profileId, { expectedConfigVersion: row.configVersion });
    expect(MediaVideoProfileVerificationSchema.parse(result)).toEqual(result);
    expect(result).toMatchObject({ mock: true, executionTested: false, profile: { enabled: false, verified: true } });
    expect(result.profile.configVersion).not.toBe('cfg_video');
    expect(await service.updateProfile(row.profileId, { expectedConfigVersion: row.configVersion, enabled: true })).toMatchObject({ enabled: true, verified: true });
  });

  it('keeps real and merely similarly named models unverifiable and unexecutable', async () => {
    const { service, row } = setup();
    for (const modelId of ['real-video', 'mock-video-model', 'mock-video-v1-custom']) {
      row.modelId = modelId;
      await expect(service.verifyProfile(row.profileId, { expectedConfigVersion: row.configVersion })).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.updateProfile(row.profileId, { expectedConfigVersion: row.configVersion, enabled: true })).rejects.toBeInstanceOf(BadRequestException);
      expect(await service.getRuntimeVideo('ent-1')).toMatchObject({ executionAvailable: false, profiles: [], tools: [] });
    }
  });

  it.each([
    { durationsSeconds: [10] }, { aspectRatios: ['16:9'] }, { resolutions: ['1080p'] },
    { frameRates: [30] }, { supportsAudio: true }, { supportsCancel: true },
    { outputFormats: ['video/webm'] }, { supportsTextToVideo: true },
    { maxReferenceCount: 2 }, { maxInputBytes: 20 * 1024 * 1024 }, { maxInputBytes: 1 },
    { resultRetentionSeconds: 172800 }, { resultRetentionSeconds: 3600 },
  ])('does not verify unsupported fixture capabilities: %s', async capabilities => {
    const { service, row, prisma } = setup();
    row.capabilities = { ...row.capabilities, ...capabilities };
    await expect(service.verifyProfile(row.profileId, { expectedConfigVersion: row.configVersion })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.mediaModelProfile.updateMany).not.toHaveBeenCalled();
    expect((await service.getRuntimeVideo('ent-1')).executionAvailable).toBe(false);
  });

  it.each([undefined, 'false', 'TRUE', true])('requires explicit string true for discovery, verify, enable, and runtime: %s', async flag => {
    const { service, config, row, prisma } = setup();
    config.get.mockReturnValue(flag);
    expect((await service.discoverModels()).models).toEqual([]);
    await expect(service.verifyProfile(row.profileId, { expectedConfigVersion: row.configVersion })).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(service.updateProfile(row.profileId, { expectedConfigVersion: row.configVersion, enabled: true })).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(await service.getRuntimeVideo('ent-1')).toEqual({ protocolVersion: 1, executionAvailable: false, profiles: [], tools: [], defaultProfileId: null });
    expect(prisma.mediaModelProfile.updateMany).not.toHaveBeenCalled();
  });

  it('discovers just a mock fixture suggestion without auto-creating or verifying', async () => {
    const { service, prisma } = setup();
    const result = await service.discoverModels();
    expect(MediaVideoModelDiscoverySchema.parse(result)).toEqual(result);
    expect(result).toMatchObject({ mock: true, executionTested: false, models: [{ modelId: 'mock-video-v1', compatible: true }] });
    expect(prisma.mediaModelProfile.create).not.toHaveBeenCalled();
    expect(prisma.mediaModelProfile.updateMany).not.toHaveBeenCalled();
  });

  it('disables discovery, verification, available profiles, and runtime in production even with mock explicitly true', async () => {
    const { service, config, row } = setup();
    config.get.mockImplementation(key => key === 'NODE_ENV' ? 'production' : 'true');
    expect((await service.discoverModels()).models).toEqual([]);
    expect(await service.getAvailableProfiles('user-1')).toEqual([]);
    expect((await service.getRuntimeVideo('ent-1')).executionAvailable).toBe(false);
    expect((await service.getEnterpriseConfig('user-1')).configured).toBe(false);
    await expect(service.verifyProfile(row.profileId, { expectedConfigVersion: row.configVersion })).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(service.updateProfile(row.profileId, { enabled: true, expectedConfigVersion: row.configVersion })).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('preserves verification for display changes and revokes both flags for model or capability changes', async () => {
    const { service, row } = setup();
    expect(await service.updateProfile(row.profileId, { displayName: '新名称', expectedConfigVersion: row.configVersion })).toMatchObject({ enabled: true, verified: true });
    expect(await service.updateProfile(row.profileId, { modelId: 'future-real-video', enabled: true, expectedConfigVersion: row.configVersion })).toMatchObject({ enabled: false, verified: false });
    row.enabled = true; row.verified = true; row.modelId = 'mock-video-v1';
    expect(await service.updateProfile(row.profileId, { capabilities: { durationsSeconds: [10] }, enabled: true, expectedConfigVersion: row.configVersion })).toMatchObject({ enabled: false, verified: false });
  });

  it('revokes verification for operation changes and rejects inconsistent capability updates', async () => {
    const { service, row } = setup();
    await expect(service.updateProfile(row.profileId, { capabilities: { supportsImageToVideo: false }, expectedConfigVersion: row.configVersion })).rejects.toBeInstanceOf(BadRequestException);
    expect(await service.updateProfile(row.profileId, { operations: ['text-to-video'], capabilities: { supportsTextToVideo: true }, expectedConfigVersion: row.configVersion }))
      .toMatchObject({ enabled: false, verified: false });
  });

  it('requires verification to enable and refuses cross-kind lookups', async () => {
    const { service, row } = setup();
    row.verified = false;
    await expect(service.updateProfile(row.profileId, { enabled: true, expectedConfigVersion: row.configVersion })).rejects.toBeInstanceOf(BadRequestException);
    row.kind = 'image';
    await expect(service.updateProfile(row.profileId, { enabled: false, expectedConfigVersion: row.configVersion })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.verifyProfile(row.profileId, { expectedConfigVersion: row.configVersion })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects stale and racing profile changes through CAS', async () => {
    const { service, row, prisma } = setup();
    await expect(service.updateProfile(row.profileId, { displayName: 'x', expectedConfigVersion: 'stale' })).rejects.toBeInstanceOf(ConflictException);
    await expect(service.verifyProfile(row.profileId, { expectedConfigVersion: 'stale' })).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.mediaModelProfile.updateMany).not.toHaveBeenCalled();
    prisma.mediaModelProfile.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.updateProfile(row.profileId, { enabled: false, expectedConfigVersion: row.configVersion })).rejects.toBeInstanceOf(ConflictException);
    await expect(service.verifyProfile(row.profileId, { expectedConfigVersion: row.configVersion })).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('MediaVideoConfigService enterprise isolation', () => {
  it('defaults to disabled when enterprise configuration is absent and uses authenticated enterprise context', async () => {
    const { service, prisma, context, setStored } = setup();
    setStored(null);
    const result = await service.getEnterpriseConfig('user-1');
    expect(MediaVideoEnterpriseConfigSchema.parse(result)).toEqual(result);
    expect(result.policy).toEqual(MediaVideoPolicySchema.parse({}));
    expect(context.resolve).toHaveBeenCalledWith('user-1');
    expect(prisma.enterpriseModelConfig.findUnique).toHaveBeenCalledWith({ where: { enterpriseId: 'ent-1' } });
    expect((await service.getRuntimeVideo('ent-1')).executionAvailable).toBe(false);
  });

  it('removes model IDs from enterprise choices and excludes disabled/unverified profiles', async () => {
    const { service, row, context } = setup();
    const available = await service.getAvailableProfiles('user-1');
    expect(available).toHaveLength(1);
    expect(available[0]).not.toHaveProperty('modelId');
    expect(context.resolve).toHaveBeenCalledWith('user-1');
    row.enabled = false;
    expect(await service.getAvailableProfiles('user-1')).toEqual([]);
    row.enabled = true; row.verified = false;
    expect(await service.getAvailableProfiles('user-1')).toEqual([]);
  });

  it('publishes only the safe capability intersection and the two mock tools', async () => {
    const { service, row, getStored } = setup();
    getStored().mediaPolicy.video.allowedOperations = ['image-to-video', 'text-to-video'];
    const result = await service.getRuntimeVideo('ent-1');
    expect(MediaVideoRuntimeSchema.parse(result)).toEqual(result);
    expect(result).toMatchObject({ executionAvailable: true, tools: ['video_from_image', 'video_get_job'], profiles: [{ operations: ['image-to-video'], capabilities: { supportsAudio: false, supportsCancel: false } }] });
    expect(JSON.stringify(result)).not.toContain('modelId');
    expect(result.profiles[0]).not.toHaveProperty('verified');
    expect(result.defaultProfileId).toBe(row.profileId);
  });

  it.each([
    { maxDurationSeconds: 4 }, { allowedAspectRatios: ['16:9'] }, { maxResolution: '480p' },
    { allowedOperations: ['text-to-video'] }, { enabledProfileIds: [] },
  ])('never expands capabilities beyond policy: %s', async changes => {
    const { service, getStored } = setup();
    Object.assign(getStored().mediaPolicy.video, changes);
    expect(await service.getRuntimeVideo('ent-1')).toEqual({ protocolVersion: 1, executionAvailable: false, profiles: [], tools: [], defaultProfileId: null });
  });

  it('fails closed for malformed saved video policy without advertising execution', async () => {
    const { service, getStored } = setup();
    getStored().mediaPolicy.video.maxConcurrentJobs = -1;
    expect((await service.getRuntimeVideo('ent-1')).executionAvailable).toBe(false);
  });

  it('keeps image policy on video updates and keeps video policy on image updates in Serializable transactions', async () => {
    const { service, imageService, prisma, imagePolicy, videoPolicy, getStored, row } = setup();
    await service.updateEnterpriseConfig('user-1', { periodBudget: 200, maxConcurrentJobs: 2 });
    expect(getStored().mediaPolicy).toMatchObject({ ...imagePolicy, video: { ...videoPolicy, periodBudget: 200, maxConcurrentJobs: 2 } });
    // No enabled image rows are required to change a policy with no image grants.
    getStored().mediaPolicy.enabledProfileIds = [];
    getStored().mediaPolicy.defaultProfileId = null;
    const videoBefore = structuredClone(getStored().mediaPolicy.video);
    await imageService.updateEnterpriseConfig('user-1', { maxOutputs: 3 });
    expect(getStored().mediaPolicy).toMatchObject({ maxOutputs: 3, video: videoBefore });
    expect(prisma.$transaction).toHaveBeenNthCalledWith(1, expect.any(Function), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    expect(prisma.$transaction).toHaveBeenNthCalledWith(2, expect.any(Function), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    expect((await service.getRuntimeVideo('ent-1')).defaultProfileId).toBe(row.profileId);
  });

  it('preserves arbitrary independent image JSON fields rather than reconstructing the image policy', async () => {
    const { service, getStored } = setup();
    getStored().mediaPolicy.imageFutureField = { keep: true };
    await service.updateEnterpriseConfig('user-1', { periodBudget: 10 });
    expect(getStored().mediaPolicy.imageFutureField).toEqual({ keep: true });
  });

  it('preserves video JSON even if the image policy cannot parse it', async () => {
    const { imageService, getStored } = setup();
    const video = { futureVideoField: 'do-not-drop' };
    getStored().mediaPolicy = { video };
    await imageService.updateEnterpriseConfig('user-1', { maxOutputs: 3 });
    expect(getStored().mediaPolicy.video).toEqual(video);
  });

  it('does not reset valid image grants and limits when independent video JSON is malformed', async () => {
    const { imageService, imagePolicy, getStored } = setup();
    getStored().mediaPolicy.video = { futureVideoField: 'keep' };
    expect((await imageService.getEnterpriseConfig('user-1')).policy).toEqual(imagePolicy);
    expect(getStored().mediaPolicy.video).toEqual({ futureVideoField: 'keep' });
  });

  it('rejects non-admin updates, unavailable grants, and defaults outside the allowlist', async () => {
    const { service, context, row } = setup();
    await expect(service.updateEnterpriseConfig('user-1', { enabledProfileIds: ['unknown'] })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.updateEnterpriseConfig('user-1', { defaultProfileId: 'unknown' })).rejects.toBeInstanceOf(BadRequestException);
    row.verified = false;
    await expect(service.updateEnterpriseConfig('user-1', { enabledProfileIds: [row.profileId] })).rejects.toBeInstanceOf(BadRequestException);
    context.resolve.mockResolvedValue({ enterpriseId: 'ent-1', role: 'MEMBER' });
    expect((await service.getEnterpriseConfig('user-1')).canEdit).toBe(false);
    await expect(service.updateEnterpriseConfig('user-1', {})).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each(['P2034', 'P2002'])('returns a retryable conflict instead of overwriting concurrent policy data: %s', async code => {
    const { service, prisma } = setup();
    prisma.$transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('concurrent change', { code, clientVersion: 'test' }));
    await expect(service.updateEnterpriseConfig('user-1', { periodBudget: 42 })).rejects.toBeInstanceOf(ConflictException);
  });
});
