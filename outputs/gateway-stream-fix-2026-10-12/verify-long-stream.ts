// Local synthetic HTTP acceptance check. No production calls, tokens, or billing.
// From backend: pnpm exec ts-node --project tsconfig.json --transpile-only -r tsconfig-paths/register ../outputs/gateway-stream-fix-2026-10-12/verify-long-stream.ts
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { parse } from 'node:url';
import { ConfigService } from '@nestjs/config';
import { GatewayController } from '../../backend/src/modules/gateway/gateway.controller';
import { GatewayService } from '../../backend/src/modules/gateway/gateway.service';

const webRequire = createRequire(`${process.cwd()}/../web/package.json`);
const { proxyRequest } = webRequire('next/dist/server/lib/router-utils/proxy-request');
const loadConfig = webRequire('next/dist/server/config').default;
const model = 'deepseek-v4.1-flash';
const first = 'data:{"choices":[{"delta":{"content":"synthetic"},"finish_reason":null}]}\r\n\r\n';
const last = 'data:{"choices":[{"delta":{},"finish_reason":"stop"}]}\r\n\r\ndata:[DONE]\r\n\r\n';
let prematureClose = false;
const servers: Server[] = [];

async function listen(server: Server) {
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  return `http://127.0.0.1:${address.port}`;
}

async function main() {
  const upstreamUrl = await listen(createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(first);
    const timer = setTimeout(() => res.end(last), 35000);
    res.on('close', () => { prematureClose ||= !res.writableEnded; clearTimeout(timer); });
  }));
  const service = new GatewayService({} as never, new ConfigService(), {} as never, {} as never);
  service.getSub2ApiConfig = async () => ({ baseUrl: `${upstreamUrl}/v1`, apiKey: 'synthetic', defaultModel: model });
  service.validateAndAuthorize = async () => ({
    enterpriseId: 'synthetic-enterprise', subscriptionId: 'synthetic-subscription',
    memberId: 'synthetic-member', employeeId: 'synthetic-employee', allowedModels: [model],
  });
  service.recordTransaction = async () => undefined;
  const controller = new GatewayController(service);
  const gatewayUrl = await listen(createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      void controller.chatCompletions(
        { model, messages: [{ role: 'user', content: 'synthetic' }], stream: true },
        { sub: 'synthetic-user', enterpriseId: 'synthetic-enterprise', subscriptionId: 'synthetic-subscription', memberId: 'synthetic-member' } as never,
        {}, Object.assign(req, { requestId: 'synthetic-long-stream' }) as never, res as never,
      ).catch(() => res.destroy());
    });
  }));
  const config = await loadConfig('phase-production-server', `${process.cwd()}/../web`);
  assert.equal(config.experimental.proxyTimeout, 180000);
  const proxyUrl = await listen(createServer((req, res) => {
    void proxyRequest(req, res, parse(`${gatewayUrl}${req.url}`, true), undefined, undefined, config.experimental.proxyTimeout)
      .catch(() => res.destroy());
  }));
  const startedAt = Date.now();
  const response = await fetch(`${proxyUrl}/api/gateway/v1/chat/completions`, {
    method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(45000),
  });
  assert.equal(response.status, 200);
  const body = await response.text();
  const elapsedMs = Date.now() - startedAt;
  assert.equal(body, first + last);
  assert.equal(prematureClose, false);
  assert(elapsedMs >= 35000);
  console.log(JSON.stringify({ passed: true, elapsedMs, bytes: Buffer.byteLength(body), finishReason: 'stop', done: true,
    prematureClose, webProxyTimeoutMs: config.experimental.proxyTimeout,
    path: 'real upstream HTTP -> GatewayService -> GatewayController -> installed Next proxy -> HTTP client' }, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await Promise.all(servers.map(server => {
    server.closeAllConnections();
    return new Promise<void>(resolve => server.close(() => resolve()));
  }));
});
