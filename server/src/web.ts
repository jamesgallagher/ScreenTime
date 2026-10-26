import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import type { OpenAPIHono } from '@hono/zod-openapi';

/** Content types for the files that `vite build` writes. Anything else is sent as bytes. */
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * Only this server's own files, styles may be inline (Radix sets style attributes), and no page may frame the app.
 * The web app talks to the API on the same origin (docs/SPEC.md §4.2).
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const HEADERS = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};

/**
 * Serves the built parent web app from `dir` (docs/SPEC.md §4.2). Register it after every API route.
 * - A file that exists is sent. Files under `/assets/` have a content hash in their name, so browsers keep them for a year;
 *   everything else is checked again on each visit.
 * - Any other path without a file extension, like `/kids/123`, gets `index.html`: the app's router shows the page.
 * - `/v1/...`, `/health` and a missing file with an extension fall through to the JSON 404.
 */
export function registerWeb(app: OpenAPIHono, dir: string) {
  const root = resolve(dir);

  app.get('*', async (c, next) => {
    const path = c.req.path;
    if (path === '/v1' || path.startsWith('/v1/') || path === '/health') {
      return next();
    }
    // Hono has already decoded the path. A path that leaves the folder is never read.
    const file = resolve(root, `.${path}`);
    if (file !== root && !file.startsWith(root + sep)) {
      return next();
    }
    const ext = extname(file);
    const sent = ext ? await read(file) : null;
    if (sent) {
      const cache = path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
      return c.body(sent, 200, { ...HEADERS, 'Content-Type': TYPES[ext] ?? 'application/octet-stream', 'Cache-Control': cache });
    }
    if (ext) {
      return next();
    }
    const index = await read(resolve(root, 'index.html'));
    if (!index) {
      return next();
    }
    return c.body(index, 200, { ...HEADERS, 'Content-Type': TYPES['.html']!, 'Cache-Control': 'no-cache' });
  });
}

/** The file's bytes, or null when it does not exist or is a folder. */
async function read(file: string) {
  try {
    return await readFile(file);
  } catch {
    return null;
  }
}
