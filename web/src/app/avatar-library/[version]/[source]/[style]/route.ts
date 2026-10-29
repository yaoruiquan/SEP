import { createHash } from 'node:crypto';
import { AVATAR_RENDER_VERSION } from 'shared/dicebear-styles';
import { renderLibraryAvatar } from '@/features/avatar-library/render-avatar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ version: string; source: string; style: string }> }) {
  const { version, source, style } = await context.params;
  if (version !== AVATAR_RENDER_VERSION) return new Response('Unknown avatar version', { status: 404 });
  const query = new URL(request.url).searchParams;
  const seed = query.get('seed') ?? 'preview';
  const name = query.get('name') ?? seed;
  if (!seed || seed.length > 128 || !name || name.length > 100 || /[\u0000-\u001f]/.test(seed + name)) {
    return new Response('Invalid avatar seed or name', { status: 400 });
  }
  const svg = await renderLibraryAvatar(source, style, seed, name);
  if (!svg) return new Response('Unknown avatar style', { status: 404 });
  const etag = `"${createHash('sha256').update(svg).digest('hex')}"`;
  const headers = {
    'Content-Type': 'image/svg+xml; charset=utf-8',
    'Cache-Control': 'public, max-age=86400, s-maxage=604800',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
    'X-Content-Type-Options': 'nosniff',
    ETag: etag,
  };
  if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
  return new Response(svg, { headers });
}
