export function validateMediaElectronReviewConfig(environment: Record<string, string | undefined>): void {
  if (environment.SEP_PI_MEDIA_MOCK_REVIEW !== 'true') return;

  const databaseName = environment.SEP_PI_MEDIA_MOCK_DATABASE;
  if (!databaseName || databaseName !== databaseName.trim() ||
      !/^sep_pi_media_mock_[a-z0-9_]+$/.test(databaseName)) {
    throw new Error('Skill review requires an explicit SEP_PI_MEDIA_MOCK_DATABASE=sep_pi_media_mock_*');
  }

  let database: URL;
  try {
    database = new URL(environment.DATABASE_URL ?? '');
  } catch {
    throw new Error('Skill review requires a valid local PostgreSQL business database URL');
  }
  if (!['postgres:', 'postgresql:'].includes(database.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(database.hostname) ||
      database.pathname !== `/${databaseName}` ||
      [...database.searchParams.keys()].some(key => key.toLowerCase() === 'host')) {
    throw new Error('Skill review requires the declared local business database without a host override');
  }
}
