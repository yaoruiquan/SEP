import { validateMediaElectronReviewConfig } from './media-electron-review-config';

describe('validateMediaElectronReviewConfig', () => {
  const databaseName = 'sep_pi_media_mock_review_1';
  const validEnvironment = {
    SEP_PI_MEDIA_MOCK_REVIEW: 'true',
    SEP_PI_MEDIA_MOCK_DATABASE: databaseName,
    DATABASE_URL: `postgresql://review:private-password@localhost:5432/${databaseName}`,
  };

  it.each([undefined, '', 'false', 'TRUE', '1'])('does nothing when review is %p', review => {
    expect(() => validateMediaElectronReviewConfig({
      SEP_PI_MEDIA_MOCK_REVIEW: review,
      SEP_PI_MEDIA_MOCK_DATABASE: 'production',
      DATABASE_URL: 'not a URL',
    })).not.toThrow();
  });

  it.each(['postgres', 'postgresql'])('accepts %s with each loopback hostname', protocol => {
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
      expect(() => validateMediaElectronReviewConfig({
        ...validEnvironment,
        DATABASE_URL: `${protocol}://review:private-password@${host}:5432/${databaseName}?schema=public`,
      })).not.toThrow();
    }
  });

  it.each([undefined, '', 'sep_pi_media_mock_', 'production', 'sep_pi_media_mock_Review',
    'sep_pi_media_mock_review-1', 'sep_pi_media_mock_review/1', `${databaseName}\n`])(
    'rejects missing or invalid database declaration %p', declaration => {
      expect(() => validateMediaElectronReviewConfig({
        ...validEnvironment,
        SEP_PI_MEDIA_MOCK_DATABASE: declaration,
      })).toThrow('explicit SEP_PI_MEDIA_MOCK_DATABASE');
    },
  );

  it.each([
    ['missing URL', undefined],
    ['empty URL', ''],
    ['malformed URL', 'postgresql://review:private-password@[::1'],
    ['invalid port', `postgresql://localhost:invalid/${databaseName}`],
    ['different review database', 'postgresql://localhost/sep_pi_media_mock_other'],
    ['ordinary business database', 'postgresql://localhost/sep'],
    ['missing pathname', 'postgresql://localhost'],
    ['trailing slash', `postgresql://localhost/${databaseName}/`],
    ['nested pathname', `postgresql://localhost/${databaseName}/other`],
    ['encoded pathname', 'postgresql://localhost/sep_pi_media_mock_%72eview_1'],
    ['non-PostgreSQL protocol', `https://localhost/${databaseName}`],
    ['remote hostname', `postgresql://db.example.com/${databaseName}`],
    ['remote IPv4', `postgresql://192.168.1.1/${databaseName}`],
    ['remote IPv6', `postgresql://[2001:db8::1]/${databaseName}`],
    ['loopback-looking hostname', `postgresql://localhost.example.com/${databaseName}`],
    ['query host override', `${validEnvironment.DATABASE_URL}?host=remote.example.com`],
    ['mixed case host override', `${validEnvironment.DATABASE_URL}?HoSt=localhost`],
    ['encoded host override', `${validEnvironment.DATABASE_URL}?%68ost=localhost`],
    ['empty host override', `${validEnvironment.DATABASE_URL}?host=`],
    ['duplicate host override', `${validEnvironment.DATABASE_URL}?schema=public&host=localhost&host=remote`],
  ])('rejects %s without exposing the DSN', (_description, databaseUrl) => {
    let error: unknown;
    try {
      validateMediaElectronReviewConfig({ ...validEnvironment, DATABASE_URL: databaseUrl });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).not.toContain('private-password');
    if (databaseUrl) expect(message).not.toContain(databaseUrl);
    expect(error).not.toHaveProperty('cause');
  });
});
