import express from 'express';
import request from 'supertest';
import { configureTrustedProxy } from './trusted-proxy';

describe('Explicit proxy trust over HTTP', () => {
  function fixture(cidrs: string) {
    const app = express();
    configureTrustedProxy(app, cidrs);
    app.get('/', (req, res) => res.json({ ip: req.ip, ips: req.ips }));
    return app;
  }

  it('ignores forwarded identity by default and when the socket peer is not trusted', async () => {
    for (const trust of ['', '10.12.0.2/32']) {
      const response = await request(fixture(trust)).get('/')
        .set('X-Forwarded-For', '203.0.113.25').set('X-Real-IP', '203.0.113.26').expect(200);
      expect(response.body.ip).not.toBe('203.0.113.25');
      expect(response.body.ip).not.toBe('203.0.113.26');
      expect(response.body.ips).toEqual([]);
    }
  });

  it('stops at the first untrusted hop instead of accepting the arbitrary leftmost address', async () => {
    const response = await request(fixture('127.0.0.1/32,::1/128')).get('/')
      .set('X-Forwarded-For', '203.0.113.25, 10.12.0.2').expect(200);
    expect(response.body.ip).toBe('10.12.0.2');
    expect(response.body.ips).toEqual(['10.12.0.2']);
  });

  it('resolves the client through only the explicitly trusted chain', async () => {
    const response = await request(fixture('127.0.0.1/32,::1/128,10.12.0.2/32')).get('/')
      .set('X-Forwarded-For', '203.0.113.25, 198.51.100.8, 10.12.0.2').expect(200);
    expect(response.body.ip).toBe('198.51.100.8');
    expect(response.body.ips).toEqual(['198.51.100.8', '10.12.0.2']);
  });

  it.each(['true', '1', '0.0.0.0/0', '::/0', '127.0.0.1/33', '::1/129', 'loopback', 'invalid', '127.0.0.1/-1', '127.0.0.1/32/extra', ',,'])('rejects unsafe or invalid proxy trust %s', cidrs => {
    expect(() => fixture(cidrs)).toThrow('TRUSTED_PROXY_CIDRS');
  });
});
