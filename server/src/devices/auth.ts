import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Context } from 'hono';
import type { Db } from '../db/client.js';
import { devices, families, kids } from '../db/schema.js';
import { ApiError } from '../errors.js';
import { hashDeviceToken } from './token.js';

export interface DeviceAuth {
  deviceId: string;
  kidId: string;
  familyId: string;
}

/**
 * The calling kid device, from its Bearer device token. Throws 401 if the token is missing or
 * unknown, or once the device is revoked, its kid archived or its family disabled. Updates
 * `last_seen_at`. Uses the owner connection: the family is not known until the token is looked up.
 */
export async function requireDevice(c: Context, db: Db): Promise<DeviceAuth> {
  const header = c.req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  if (!token) throw new ApiError('unauthorized', 'This device is not enrolled.');
  const [device] = await db
    .update(devices)
    .set({ lastSeenAt: sql`now()` })
    .where(
      and(
        eq(devices.tokenHash, hashDeviceToken(token)),
        isNull(devices.revokedAt),
        sql`exists (select 1 from ${kids} where ${kids.id} = ${devices.kidId} and ${kids.archivedAt} is null)`,
        sql`exists (select 1 from ${families} where ${families.id} = ${devices.familyId} and ${families.disabledAt} is null)`,
      ),
    )
    .returning({ deviceId: devices.id, kidId: devices.kidId, familyId: devices.familyId });
  if (!device) throw new ApiError('unauthorized', 'This device is not enrolled.');
  return device;
}
