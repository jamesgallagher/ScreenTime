// Plays the parent's side of parent mode in the development database, as a parent would in the app, to try parent
// mode on the emulator. "yes" and "no" answer the kid's newest "I'm the parent" through the API, so the server pushes
// `parent_mode` to the device; "code" prints the parent code the parent app would show now; "end" ends parent mode
// on the kid's device through the API, as "End parent mode" in the app would. It signs a short-lived parent token
// with JWT_SECRET for the family's first parent; the server must use the same secret.
// Usage (from the repo root, with DATABASE_URL and JWT_SECRET set):
//   pnpm --filter @screentime/server exec tsx scripts/dev-parent-mode.ts Alex yes [2|5|15|60|forever]
//   pnpm --filter @screentime/server exec tsx scripts/dev-parent-mode.ts Alex no
//   pnpm --filter @screentime/server exec tsx scripts/dev-parent-mode.ts Alex code
//   pnpm --filter @screentime/server exec tsx scripts/dev-parent-mode.ts Alex end
// "yes" turns parent mode on for 15 minutes unless it says otherwise. The API is at http://localhost:8080 unless
// API_URL says otherwise. Never run this against the production database.
import { createHmac, randomUUID } from "node:crypto";
import { and, asc, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { signAccessToken } from "../src/auth/tokens.js";
import { createDb } from "../src/db/client.js";
import {
  families,
  kids,
  parentModeSessions,
  parents,
} from "../src/db/schema.js";

const databaseUrl = process.env.DATABASE_URL;
const jwtSecret = process.env.JWT_SECRET;
const kidName = process.argv[2]?.trim();
const action = process.argv[3];
const durationArg = action === "yes" ? (process.argv[4] ?? "15") : undefined;
const durationMin =
  durationArg === undefined || durationArg === "forever"
    ? null
    : Number(durationArg);
const apiUrl = (process.env.API_URL ?? "http://localhost:8080").replace(
  /\/+$/,
  "",
);
if (
  !databaseUrl ||
  !jwtSecret ||
  !kidName ||
  (action !== "yes" &&
    action !== "no" &&
    action !== "code" &&
    action !== "end") ||
  (durationMin !== null && ![2, 5, 15, 60].includes(durationMin))
) {
  console.error(
    "Usage: DATABASE_URL=postgres://... JWT_SECRET=... tsx scripts/dev-parent-mode.ts <kid name> <yes [2|5|15|60|forever] | no | code | end>",
  );
  process.exit(1);
}

/** RFC 4648 base32, any case, padding ignored. */
function base32Decode(text: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const c of text.toUpperCase().replace(/=+$/, "")) {
    const value = alphabet.indexOf(c);
    if (value < 0)
      throw new Error(`the parent-code secret has a bad character: ${c}`);
    buffer = ((buffer << 5) | value) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >>> bits) & 0xff);
    }
  }
  return Buffer.from(out);
}

/** The 6-digit parent code (RFC 6238: SHA-1, 30-second steps) at timeMs, as the kid app checks it. */
function parentCode(secret: string, timeMs: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(timeMs / 30_000)));
  const hash = createHmac("sha1", base32Decode(secret))
    .update(counter)
    .digest();
  const at = hash[hash.length - 1]! & 0x0f;
  const number = hash.readUInt32BE(at) & 0x7fffffff;
  return String(number % 1_000_000).padStart(6, "0");
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

  if (action === "code") {
    const [family] = await db
      .select({ secret: families.parentCodeSecret })
      .from(families)
      .where(eq(families.id, kid.familyId));
    if (!family) throw new Error(`the family of ${kid.name} is missing`);
    const now = Date.now();
    const left = 30 - Math.floor((now % 30_000) / 1000);
    console.log(
      `The parent code for ${kid.name}'s family is ${parentCode(family.secret, now)} (changes in ${left} s).`,
    );
  } else {
    const [parent] = await db
      .select()
      .from(parents)
      .where(
        and(eq(parents.familyId, kid.familyId), isNull(parents.disabledAt)),
      )
      .orderBy(asc(parents.createdAt))
      .limit(1);
    if (!parent) throw new Error(`the family of ${kid.name} has no parent`);
    const token = await signAccessToken(jwtSecret, {
      sessionId: randomUUID(),
      parentId: parent.id,
      familyId: kid.familyId,
      roles: ["parent"],
    });
    const send = async (method: string, path: string, body?: unknown) => {
      const response = await fetch(`${apiUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!response.ok) {
        throw new Error(
          `the API said ${response.status} to ${method} ${path}: ${await response.text()}`,
        );
      }
    };

    if (action === "end") {
      const [active] = await db
        .select()
        .from(parentModeSessions)
        .where(
          and(
            eq(parentModeSessions.kidId, kid.id),
            isNotNull(parentModeSessions.startedAt),
            isNull(parentModeSessions.endedAt),
            sql`(${parentModeSessions.endsAt} is null or ${parentModeSessions.endsAt} > now())`,
          ),
        )
        .orderBy(desc(parentModeSessions.startedAt))
        .limit(1);
      if (!active) throw new Error(`${kid.name} has no parent mode on`);
      await send("DELETE", `/v1/devices/${active.deviceId}/parent-mode`);
      console.log(
        `${parent.displayName} ended parent mode on ${kid.name}'s device.`,
      );
    } else {
      const [request] = await db
        .select()
        .from(parentModeSessions)
        .where(
          and(
            eq(parentModeSessions.kidId, kid.id),
            eq(parentModeSessions.method, "push"),
            isNull(parentModeSessions.startedAt),
            isNull(parentModeSessions.endedAt),
          ),
        )
        .orderBy(desc(parentModeSessions.requestedAt))
        .limit(1);
      if (!request)
        throw new Error(
          `${kid.name} has no "I'm the parent" waiting for an answer`,
        );
      if (action === "yes") {
        await send("POST", `/v1/parent-mode-requests/${request.id}/approve`, {
          durationMin,
        });
        const how =
          durationMin === null
            ? "until a parent ends it"
            : `for ${durationMin} min`;
        console.log(
          `${parent.displayName} turned parent mode on for ${kid.name} ${how}.`,
        );
      } else {
        await send("POST", `/v1/parent-mode-requests/${request.id}/deny`);
        console.log(
          `${parent.displayName} said no to ${kid.name}'s "I'm the parent".`,
        );
      }
    }
  }
} finally {
  await pg.end();
}
