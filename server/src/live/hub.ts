import type { Envelope } from '@screentime/schemas';

/** The part of a WebSocket the hub uses. */
export interface LiveSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

/** Close codes the server uses (4000 to 4999 are free for applications). */
export const CLOSE_IDLE = 4408;
export const CLOSE_REVOKED = 4401;

/**
 * The kid devices connected by WebSocket right now (docs/SPEC.md §8.3, §10), kept in memory: the server
 * runs as one process. A device may have more than one socket for a moment while it reconnects.
 */
export class LiveHub {
  /** A socket that sends nothing for this long is closed. Devices ping every 30 s. */
  readonly idleMs: number;
  readonly #sockets = new Map<string, Set<LiveSocket>>();

  constructor(options: { idleMs?: number } = {}) {
    this.idleMs = options.idleMs ?? 75_000;
  }

  add(deviceId: string, socket: LiveSocket) {
    const set = this.#sockets.get(deviceId) ?? new Set<LiveSocket>();
    set.add(socket);
    this.#sockets.set(deviceId, set);
  }

  remove(deviceId: string, socket: LiveSocket) {
    const set = this.#sockets.get(deviceId);
    if (!set) return;
    set.delete(socket);
    if (set.size === 0) this.#sockets.delete(deviceId);
  }

  /** How many sockets this device has open. */
  count(deviceId: string) {
    return this.#sockets.get(deviceId)?.size ?? 0;
  }

  /** Sends the message to every socket of these devices. Returns how many sockets it went to. */
  send(deviceIds: Iterable<string>, msg: Envelope) {
    const text = JSON.stringify(msg);
    let sent = 0;
    for (const id of deviceIds) {
      for (const socket of this.#sockets.get(id) ?? []) {
        try {
          socket.send(text);
          sent += 1;
        } catch (err) {
          console.error('websocket send failed', err);
        }
      }
    }
    return sent;
  }

  /** Closes every socket of these devices, for example when a device is revoked. */
  close(deviceIds: Iterable<string>, code: number, reason: string) {
    for (const id of deviceIds) {
      for (const socket of [...(this.#sockets.get(id) ?? [])]) {
        socket.close(code, reason);
        this.remove(id, socket);
      }
    }
  }
}
