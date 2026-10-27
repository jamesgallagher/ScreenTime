// Plays the parent's side of an SOS in the development database through the API, as a parent would in the app, to
// try SOS on the emulator: "seen" is "I'm on it" (the phone shows "Dad has seen your SOS"), "longer" keeps it on for
// 2 more hours, "end" is "End SOS", and "show" prints the kid's newest SOS with its positions. It signs a short-lived
// parent token with JWT_SECRET for the family's first parent; the server must use the same secret.
// Usage (from the repo root, with DATABASE_URL and JWT_SECRET set):
//   pnpm --filter @screentime/server exec tsx scripts/dev-sos.ts Alex show
//   pnpm --filter @screentime/server exec tsx scripts/dev-sos.ts Alex seen
//   pnpm --filter @screentime/server exec tsx scripts/dev-sos.ts Alex longer
//   pnpm --filter @screentime/server exec tsx scripts/dev-sos.ts Alex end
// The API is at http://localhost:8080 unless API_URL says otherwise. Never run this against the production database.
import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Sos, SosDetail } from "@screentime/schemas";
import { signAccessToken } from "../src/auth/tokens.js";
import { createDb } from "../src/db/client.js";
import { kids, parents } from "../src/db/schema.js";

const databaseUrl = process.env.DATABASE_URL;
const jwtSecret = process.env.JWT_SECRET;
const kidName = process.argv[2]?.trim();
const action = process.argv[3];
const apiUrl = (process.env.API_URL ?? "http://localhost:8080").replace(
  /\/+$/,
  "",
);
if (
  !databaseUrl ||
  !jwtSecret ||
  !kidName ||
  (action !== "show" &&
    action !== "seen" &&
    action !== "longer" &&
    action !== "end")
) {
  console.error(
    "Usage: DATABASE_URL=postgres://... JWT_SECRET=... tsx scripts/dev-sos.ts <kid name> <show | seen | longer | end>",
  );
  process.exit(1);
}

const { db, pool: pg } = createDb(databaseUrl);
try {
  const [kid] = await db
    .select()
    .from(kids)
    .where(sql`lower(${kids.name}) = lower(${kidName})`)
    .orderBy(asc(kids.createdAt))
    .limit(1);
  if (!kid)
    throw new Error(`no kid named ${kidName}: run scripts/seed-dev.ts first`);
  const [parent] = await db
    .select()
    .from(parents)
    .where(and(eq(parents.familyId, kid.familyId), isNull(parents.disabledAt)))
    .orderBy(asc(parents.createdAt))
    .limit(1);
  if (!parent) throw new Error(`the family of ${kid.name} has no parent`);
  const token = await signAccessToken(jwtSecret, {
    sessionId: randomUUID(),
    parentId: parent.id,
    familyId: kid.familyId,
    roles: ["parent"],
  });
  const send = async <T>(method: string, path: string): Promise<T> => {
    const response = await fetch(`${apiUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw new Error(
        `the API said ${response.status} to ${method} ${path}: ${await response.text()}`,
      );
    }
    return (await response.json()) as T;
  };

  const [newest] = await send<Sos[]>("GET", `/v1/sos?kidId=${kid.id}&limit=1`);
  if (!newest) throw new Error(`${kid.name} has never sent an SOS`);

  if (action === "show") {
    const sos = await send<SosDetail>("GET", `/v1/sos/${newest.id}`);
    const seen = sos.acks.map((a) => a.byName).join(", ") || "nobody";
    const ended = sos.endedBy
      ? `, ended by ${sos.endedBy}${sos.endedByName ? ` (${sos.endedByName})` : ""}`
      : "";
    const viaData = sos.locations.filter((l) => l.via === "data").length;
    const viaSms = sos.locations.length - viaData;
    console.log(
      `${kid.name}'s SOS is ${sos.status}${ended}; seen by ${seen}; ${sos.locations.length} position(s), ${viaData} by data and ${viaSms} by text.`,
    );
    const last = sos.lastLocation;
    if (last) {
      const accuracy =
        last.accuracyM === null ? "" : ` ±${Math.round(last.accuracyM)} m`;
      const battery =
        last.batteryPct === null ? "" : `, battery ${last.batteryPct}%`;
      console.log(
        `Last position: ${last.lat.toFixed(5)},${last.lng.toFixed(5)}${accuracy} at ${last.at}${battery}.`,
      );
    }
  } else {
    if (newest.status !== "active")
      throw new Error(`${kid.name} has no SOS on`);
    const path =
      action === "seen" ? "ack" : action === "longer" ? "extend" : "end";
    const sos = await send<Sos>("POST", `/v1/sos/${newest.id}/${path}`);
    const what =
      action === "seen"
        ? `is on it`
        : action === "longer"
          ? `kept the SOS on until ${sos.autoStopAt}`
          : `ended the SOS`;
    console.log(`${parent.displayName} ${what} (${kid.name}).`);
  }
} finally {
  await pg.end();
}
