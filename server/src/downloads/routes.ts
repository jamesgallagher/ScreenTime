import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createRoute, z } from '@hono/zod-openapi';
import { type DownloadApp, Downloads, type DownloadFile } from '@screentime/schemas';
import type { AppDeps } from '../app.js';
import { ApiError } from '../errors.js';
import { errorResponses, jsonResponse } from '../openapi.js';
import type { createRouter } from '../router.js';

type Router = ReturnType<typeof createRouter>;

/**
 * One app's file in the releases folder (docs/SPEC.md §12.5), described by `kid.json`, `parent.json` or `windows.json`,
 * written after the file by `android/publish-kid.ps1` and `deploy/publish-downloads.ps1`. Extra fields are ignored.
 */
const Published = z.object({
  versionName: z.string().min(1).max(40),
  sizeBytes: z.number().int().min(1),
  file: z.string().regex(/^[A-Za-z0-9._-]+\.(apk|msi)$/),
});

type Published = z.infer<typeof Published>;

const APPS: Record<DownloadApp, { json: string; name: string; type: string }> = {
  kid: { json: 'kid.json', name: 'ScreenTime-Kid', type: 'application/vnd.android.package-archive' },
  parent: { json: 'parent.json', name: 'ScreenTime-Parent', type: 'application/vnd.android.package-archive' },
  windows: { json: 'windows.json', name: 'ScreenTime', type: 'application/x-msi' },
};

/** The published file of [app], or null when there is none, its description is not valid (logged), or it is missing. */
async function published(dir: string | null, app: DownloadApp): Promise<(Published & { path: string }) | null> {
  if (!dir) return null;
  let text: string;
  try {
    text = await readFile(join(dir, APPS[app].json), 'utf8');
  } catch {
    return null;
  }
  let release: Published;
  try {
    release = Published.parse(JSON.parse(text));
  } catch (err) {
    console.error(`${APPS[app].json} is not valid`, err);
    return null;
  }
  const path = join(dir, release.file);
  const exists = await stat(path).then(
    (s) => s.isFile(),
    () => false,
  );
  return exists ? { ...release, path } : null;
}

/** The name a browser saves it as: "ScreenTime-Parent-0.1.1.apk", "ScreenTime-0.1.70.msi". */
function fileName(app: DownloadApp, release: Published): string {
  const extension = release.file.endsWith('.msi') ? 'msi' : 'apk';
  const version = release.versionName.replace(/[^A-Za-z0-9.]/g, '');
  return `${APPS[app].name}-${version}.${extension}`;
}

const listRoute = createRoute({
  method: 'get',
  path: '/v1/downloads',
  tags: ['public'],
  summary: 'The latest kid app, parent app and PC installer',
  description: 'No sign-in: the download page at /app uses it. An app nothing has been published for is null.',
  responses: { 200: jsonResponse('The latest of each.', Downloads), ...errorResponses() },
});

/** Public downloads of the latest apps, for the page at /app (docs/SPEC.md §12.5). */
export function registerDownloadRoutes(app: Router, deps: AppDeps) {
  // Read when asked: `config` is missing while the OpenAPI document is built.
  const releases = () => deps.config?.releasesDir ?? null;

  app.openapi(listRoute, async (c) => {
    const entry = async (name: DownloadApp): Promise<DownloadFile | null> => {
      const release = await published(releases(), name);
      if (!release) return null;
      return { versionName: release.versionName, sizeBytes: release.sizeBytes, fileName: fileName(name, release), url: `/v1/downloads/${name}/file` };
    };
    c.header('Cache-Control', 'no-store');
    return c.json({ kid: await entry('kid'), parent: await entry('parent'), windows: await entry('windows') }, 200);
  });

  // Plain bytes, so it is not in the contract.
  app.get('/v1/downloads/:app/file', async (c) => {
    const name = c.req.param('app');
    if (!(name in APPS)) throw new ApiError('not_found', 'No such download.');
    const release = await published(releases(), name as DownloadApp);
    if (!release) throw new ApiError('not_found', 'Nothing has been published for that yet.');
    const size = (await stat(release.path)).size;
    return new Response(Readable.toWeb(createReadStream(release.path)) as ReadableStream, {
      headers: {
        'Content-Type': APPS[name as DownloadApp].type,
        'Content-Length': String(size),
        'Content-Disposition': `attachment; filename="${fileName(name as DownloadApp, release)}"`,
        'Cache-Control': 'no-store',
      },
    });
  });
}
