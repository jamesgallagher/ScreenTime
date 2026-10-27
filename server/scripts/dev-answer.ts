// Answers a kid's pending "Ask for more time" in the development database through the API, as a parent would in the
// app, so the server pushes `request_resolved` to the kid's devices (to try the answer on the emulator). It signs a
// short-lived parent token with JWT_SECRET for the family's first parent; the server must use the same secret.
// Usage (from the repo root, with DATABASE_URL and JWT_SECRET set):
//   pnpm --filter @screentime/server exec tsx scripts/dev-answer.ts Alex yes [minutes]
//   pnpm --filter @screentime/server exec tsx scripts/dev-answer.ts Alex no
// "yes" gives what the kid asked for unless minutes (a multiple of 15) says otherwise. The API is at
// http://localhost:8080 unless API_URL says otherwise. Never run this against the production database.
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { signAccessToken } from "../src/auth/tokens.js";
import { createDb } from "../src/db/client.js";
import { kids, parents, timeRequests } from "../src/db/schema.js";

const databaseUrl = process.env.DATABASE_URL;
const jwtSecret = process.env.JWT_SECRET;
const kidName = process.argv[2]?.trim();
const answer = process.argv[3];
const minutes =
  answer === "yes" && process.argv[4] !== undefined
    ? Number(process.argv[4])
    : undefined;
const apiUrl = (process.env.API_URL ?? "http://localhost:8080").replace(
  /\/+$/,
  "",
);
if (
  !databaseUrl ||
  !jwtSecret ||
  !kidName ||
  (answer !== "yes" && answer !== "no") ||
  (minutes !== undefined &&
    (!Number.isInteger(minutes) ||
      minutes < 15 ||
      minutes > 1440 ||
      minutes % 15 !== 0))
) {
  console.error(
    "Usage: DATABASE_URL=postgres://... JWT_SECRET=... tsx scripts/dev-answer.ts <kid name> <yes|no> [minutes, a multiple of 15]",
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
  const [request] = await db
    .select()
    .from(timeRequests)
    .where(
      and(eq(timeRequests.kidId, kid.id), eq(timeRequests.status, "pending")),
    )
    .orderBy(desc(timeRequests.createdAt))
    .limit(1);
  if (!request)
    throw new Error(`${kid.name} has no request waiting for an answer`);
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
  const response = await fetch(
    `${apiUrl}/v1/requests/${request.id}/${answer === "yes" ? "approve" : "deny"}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body:
        answer === "yes"
          ? JSON.stringify(minutes === undefined ? {} : { minutes })
          : undefined,
    },
  );
  if (!response.ok) {
    throw new Error(
      `the API said ${response.status}: ${await response.text()}`,
    );
  }
  const given = answer === "yes" ? ` +${minutes ?? request.minutes} min` : "";
  console.log(
    `${parent.displayName} said ${answer} to ${kid.name}'s request for ${request.minutes} min (${request.reason ?? "no reason"})${given}.`,
  );
} finally {
  await pg.end();
}
