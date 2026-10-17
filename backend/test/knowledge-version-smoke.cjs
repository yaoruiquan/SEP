'use strict';

// Fixed disposable database only. Never load application .env or accept a URL override.
const { execFileSync } = require('node:child_process');
const path = require('node:path');
(async () => {
  const database = 'sep_kb_refactor_20261016';
  const password = execFileSync('docker', ['exec', 'sep-postgres', 'printenv', 'POSTGRES_PASSWORD'], { encoding: 'utf8' }).trimEnd();
  const url = new URL(`postgresql://127.0.0.1:5432/${database}`);
  url.username = 'sep'; url.password = password;
  url.searchParams.set('connection_limit', '5');
  if (url.hostname !== '127.0.0.1' || url.pathname !== '/sep_kb_refactor_20261016') throw new Error('DB_ALLOWLIST');
  process.env.DATABASE_URL = url.toString();
  process.env.TS_NODE_PROJECT = path.resolve(__dirname, '../tsconfig.json');
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { cwd: path.resolve(__dirname, '..'), env: process.env, stdio: 'pipe' });
  require('reflect-metadata');
  require('ts-node/register/transpile-only');
  require('tsconfig-paths/register');
  await require('./knowledge-version-smoke').run();
})().catch(error => {
  console.error(JSON.stringify({ status: 'failed', type: error?.constructor?.name,
    location: String(error?.stack || '').split('\n').filter(line => /^\s+at /.test(line)).slice(0, 4),
    message: error?.code === 'ERR_ASSERTION' ? error.message : 'Connection details suppressed' }));
  process.exitCode = 1;
});
