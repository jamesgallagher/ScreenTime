import { cert, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import type { Envelope } from '@screentime/schemas';

export interface PushMessage {
  /** The app's FCM registration token. */
  token: string;
  msg: Envelope;
  /** FCM high priority wakes a sleeping phone. Only for messages that show a notification (docs/SPEC.md §10). */
  high: boolean;
  /** Seconds FCM keeps trying to deliver; after that the message is dropped. FCM's default is 4 weeks. */
  ttlSec?: number;
}

export interface Pusher {
  /** Sends every message. Returns the tokens FCM says are no longer valid, so they can be cleared. */
  send(messages: PushMessage[]): Promise<string[]>;
}

/** FCM's answers for a token that will never work again (the app was uninstalled or signed out). */
const DEAD_TOKEN = new Set(['registration-token-not-registered', 'invalid-registration-token']);

/** FCM takes at most 500 messages per batch. */
const BATCH = 500;

/** Sends pushes with Firebase Cloud Messaging (docs/SPEC.md §10), or nothing when Firebase is not configured. */
export function createPusher(serviceAccountJson: string | null): Pusher {
  if (!serviceAccountJson) {
    return {
      async send() {
        return [];
      },
    };
  }
  const app = initializeApp({ credential: cert(JSON.parse(serviceAccountJson)) }, 'screentime');
  const messaging = getMessaging(app);
  return {
    async send(messages) {
      const dead: string[] = [];
      for (let i = 0; i < messages.length; i += BATCH) {
        const batch = messages.slice(i, i + BATCH);
        const result = await messaging.sendEach(
          batch.map((m) => ({
            token: m.token,
            // FCM data values must be strings, so the envelope travels as one field.
            data: { msg: JSON.stringify(m.msg) },
            android: { priority: m.high ? 'high' : 'normal', ...(m.ttlSec === undefined ? {} : { ttl: m.ttlSec * 1000 }) },
          })),
        );
        result.responses.forEach((response, j) => {
          if (response.success) return;
          const code = response.error?.code.replace(/^messaging\//, '') ?? 'unknown';
          const token = batch[j]?.token;
          if (DEAD_TOKEN.has(code) && token) dead.push(token);
          else console.error(`push not sent: ${code}: ${response.error?.message ?? ''}`);
        });
      }
      return dead;
    },
  };
}
