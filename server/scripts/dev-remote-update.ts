// Calls POST /v1/devices/<id>/app-update as the family's first enabled parent, the same route the parent app's
// "Update now" button hits, so emulator and Sandbox runs can trigger a real remote update without the web UI.
// Signs a short-lived parent token with JWT_SECRET; the server must use the same secret. Prints the HTTP status
// and the raw response body on one line. Usage (from the repo root, with DATABASE_URL and JWT_SECRET set):
//   pnpm --filter @screentime/server exec tsx scripts/dev-remote-update.ts <deviceId> [api url]
// The API is at http://localhost:8080 unless API_URL says otherwise or the third argument sets it.
// Never run this against the production database.
import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { signAccessToken } from "../src/auth/tokens.js";
import { createDb } from "../src/db/client.js";
import { devices, parents } from "../src/db/schema.js";

const databaseUrl = process.env.DATABASE_URL;
const jwtSecret = process.env.JWT_SECRET;
const deviceId = process.argv[2]?.trim();
const apiUrl = (
  process.env.API_URL ?? process.argv[3] ?? "http://localhost:8080"
).replace(/\/+$/, "");
if (!databaseUrl || !jwtSecret || !deviceId) {
  console.error(
    "Usage: DATABASE_URL=postgres://... JWT_SECRET=... tsx scripts/dev-remote-update.ts <deviceId> [api url]",
  );
  process.exit(1);
}

const { db, pool: pg } = createDb(databaseUrl);
try {
  const [device] = await db
    .select({ familyId: devices.familyId })
    .from(devices)
    .where(eq(devices.id, deviceId))
    .limit(1);
  if (!device) {
    console.error(`no device with id ${deviceId}`);
    process.exit(1);
  }
  if (!device.familyId) {
    console.error(`device ${deviceId} has no familyId`);
    process.exit(1);
  }

  const [parent] = await db
    .select()
    .from(parents)
    .where(
      and(eq(parents.familyId, device.familyId), isNull(parents.disabledAt)),
    )
    .orderBy(asc(parents.createdAt), asc(parents.id))
    .limit(1);
  if (!parent) {
    console.error(
      `the family of device ${deviceId} has no enabled parent`,
    );
    process.exit(1);
  }

  const token = await signAccessToken(jwtSecret, {
    sessionId: randomUUID(),
    parentId: parent.id,
    familyId: device.familyId,
    roles: ["parent"],
  });

  const path = `/v1/devices/${deviceId}/app-update`;
  const response = await fetch(`${apiUrl}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
  });
  const body = await response.text();
  console.log(`POST ${path} -> ${response.status} ${body}`);
} finally {
  await pg.end();
}
