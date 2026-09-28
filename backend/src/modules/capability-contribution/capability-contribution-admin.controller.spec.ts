import { CapabilityReviewAdminController } from './capability-contribution-admin.controller';

describe('CapabilityReviewAdminController version routes', () => {
  function makeController() {
    const service = {
      getVersionDiff: jest.fn(),
      reviewPlatformVersion: jest.fn(),
    };
    const controller = new CapabilityReviewAdminController(service as never);
    return { controller, service };
  }

  it('forwards the admin identity and fixed ADMIN scope for the version diff', async () => {
    const { controller, service } = makeController();
    const expected = { changed: false, reviews: [] };
    service.getVersionDiff.mockResolvedValue(expected);

    const result = await controller.versionDiff(
      { user: { id: 'platform-admin-1' } },
      'version-3',
    );

    expect(result).toBe(expected);
    expect(service.getVersionDiff).toHaveBeenCalledWith(
      'platform-admin-1',
      'version-3',
      'ADMIN',
    );
  });

  it('parses and forwards the platform review decision with the admin identity', async () => {
    const { controller, service } = makeController();
    const body = {
      decision: 'APPROVE',
      comment: '安全扫描和内容审核通过',
    };
    const expected = { status: 'APPROVED' };
    service.reviewPlatformVersion.mockResolvedValue(expected);

    const result = await controller.reviewVersion(
      { user: { id: 'platform-admin-1' } },
      'version-3',
      body,
    );

    expect(result).toBe(expected);
    expect(service.reviewPlatformVersion).toHaveBeenCalledWith(
      'platform-admin-1',
      'version-3',
      body,
    );
  });
});
