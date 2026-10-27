import { isIP } from 'node:net';
import type { Express } from 'express';

/** Trust only deployment-verified proxy addresses; never enable arbitrary XFF. */
export function configureTrustedProxy(app: Express, raw = process.env.TRUSTED_PROXY_CIDRS): void {
  if (!raw?.trim()) {
    app.set('trust proxy', false);
    return;
  }
  const cidrs = [...new Set(raw.split(',').map(value => value.trim()).filter(Boolean))];
  if (!cidrs.length || cidrs.some(cidr => {
    const [address, prefix, extra] = cidr.split('/');
    const family = isIP(address);
    if (!family || extra !== undefined) return true;
    return prefix !== undefined && (!/^\d+$/.test(prefix) || Number(prefix) < 1 || Number(prefix) > (family === 4 ? 32 : 128));
  })) {
    throw new Error('TRUSTED_PROXY_CIDRS must contain explicit proxy IPs/CIDRs; unrestricted trust and /0 are forbidden');
  }
  app.set('trust proxy', cidrs);
}
