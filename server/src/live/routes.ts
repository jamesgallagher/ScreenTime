import type { UpgradeWebSocket } from 'hono/ws';
import type { Envelope } from '@screentime/schemas';
import type { AppDeps } from '../app.js';
import { requireDevice } from '../devices/auth.js';
import { errorBody } from '../errors.js';
import type { createRouter } from '../router.js';
import { CLOSE_IDLE, type LiveHub, type LiveSocket } from './hub.js';

type Router = ReturnType<typeof createRouter>;

/**
 * `GET /v1/device/ws`: the live channel to kid devices (docs/SPEC.md §8.3, §10). The device sends its
 * token as `Authorization: Bearer <deviceToken>` with the upgrade request; a wrong or revoked token gets
 * 401 and no socket. The device sends `{ "type": "ping" }` every 30 s and gets a `pong` envelope back;
 * a socket silent for 75 s is closed (code 4408). The server only sends envelopes; usage stays on REST.
 */
export function registerLiveRoutes(
  app: Router,
  deps: AppDeps & { hub: LiveHub },
  upgradeWebSocket: UpgradeWebSocket,
) {
  const { db, hub } = deps;

  app.get(
    '/v1/device/ws',
    upgradeWebSocket(async (c) => {
      const { deviceId } = await requireDevice(c, db);
      let timer: NodeJS.Timeout | undefined;
      const restartIdleTimer = (ws: LiveSocket) => {
        clearTimeout(timer);
        timer = setTimeout(() => ws.close(CLOSE_IDLE, 'No ping for too long.'), hub.idleMs);
      };
      return {
        onOpen(_event, ws) {
          hub.add(deviceId, ws);
          restartIdleTimer(ws);
        },
        onMessage(event, ws) {
          restartIdleTimer(ws);
          let type: unknown;
          try {
            type = (JSON.parse(String(event.data)) as { type?: unknown }).type;
          } catch {
            return;
          }
          if (type === 'ping') {
            const pong: Envelope = { v: 1, type: 'pong', at: new Date().toISOString(), data: {} };
            ws.send(JSON.stringify(pong));
          }
        },
        onClose(_event, ws) {
          clearTimeout(timer);
          hub.remove(deviceId, ws);
        },
      };
    }),
    // Reached only by a request that is not a WebSocket upgrade.
    (c) => c.json(errorBody('validation_failed', 'Connect to this address with a WebSocket.'), 422),
  );
}
