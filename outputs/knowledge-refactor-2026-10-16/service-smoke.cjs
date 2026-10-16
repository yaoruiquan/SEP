#!/usr/bin/env node
'use strict';

// Run from any cwd: node outputs/knowledge-refactor-2026-10-16/service-smoke.cjs
// Intentionally never load .env, accept a DB override, or put a password in argv.
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const path = require('node:path');

(async () => {
  const database = 'sep_kb_refactor_20261016';
  const username = 'sep';
  const backend = path.resolve(__dirname, '../../backend');
  let password = execFileSync('docker', ['exec', 'sep-postgres', 'printenv', 'POSTGRES_PASSWORD'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).replace(/\r?\n$/, '');
  if (!password) throw new Error('PASSWORD_UNAVAILABLE');
  const published = execFileSync('docker', ['port', 'sep-postgres', '5432/tcp'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  const mapping = published.split('\n').find(line => /^0\.0\.0\.0:\d+$/.test(line) || /^127\.0\.0\.1:\d+$/.test(line));
  if (!mapping) throw new Error('LOOPBACK_PORT_UNAVAILABLE');
  const port = Number(mapping.slice(mapping.lastIndexOf(':') + 1));
  const url = new URL(`postgresql://127.0.0.1:${port}/${database}`);
  url.username = username;
  url.password = password;
  url.searchParams.set('schema', 'public');
  url.searchParams.set('connection_limit', '3');
  url.searchParams.set('connect_timeout', '10');
  url.searchParams.set('application_name', 'sep-kb-isolated-service-smoke');
  if (url.pathname !== '/sep_kb_refactor_20261016' || url.username !== 'sep' || url.hostname !== '127.0.0.1') {
    throw new Error('DATABASE_ALLOWLIST_REJECTED');
  }
  // Every Prisma instance below receives this same checked URL explicitly as well.
  process.env.DATABASE_URL = url.toString();
  process.env.TS_NODE_PROJECT = path.join(backend, 'tsconfig.json');
  password = undefined;
  url.password = '';
  const backendRequire = createRequire(path.join(backend, 'package.json'));
  process.chdir(backend);
  backendRequire('reflect-metadata');
  backendRequire('ts-node/register/transpile-only');
  backendRequire('tsconfig-paths/register');
  await require('./service-smoke.ts').run({ database, username, host: '127.0.0.1', port });
})().catch(error => {
  // Raw Prisma/Docker errors may contain connection details; never print them.
  console.error(JSON.stringify({ status: 'failed', errorType: error?.name || 'Error', details: 'See sanitized run evidence if created.' }));
  process.exitCode = 1;
});
