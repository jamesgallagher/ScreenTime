import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context } from 'hono';

/** The caller's IP: Cloudflare's header in production, the socket address otherwise. */
export function clientIp(c: Context): string {
  const forwarded = c.req.header('cf-connecting-ip');
  if (forwarded) return forwarded;
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown';
  }
}
