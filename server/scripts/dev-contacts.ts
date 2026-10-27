// Gives a kid's family's first parent a mobile number and replaces the kid's always-callable contacts in the
// development database through the API, as a parent would in the app, so the server tells the kid's devices
// (`state_changed`) and the block screen shows the call buttons. It signs a short-lived parent token with JWT_SECRET
// for the family's first parent; the server must use the same secret.
// Usage (from the repo root, with DATABASE_URL and JWT_SECRET set):
//   pnpm --filter @screentime/server exec tsx scripts/dev-contacts.ts Alex +61412345678 Grandma=+61298765432
// The parent's number comes first, then any number of Label=+number contacts (none clears the list). Numbers are in
// international form. The API is at http://localhost:8080 unless API_URL says otherwise. Never run this against the
// production database.
import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { signAccessToken } from "../src/auth/tokens.js";
import { createDb } from "../src/db/client.js";
import { kids, parents } from "../src/db/schema.js";

const databaseUrl = process.env.DATABASE_URL;
const jwtSecret = process.env.JWT_SECRET;
const kidName = process.argv[2]?.trim();
const parentPhone = process.argv[3];
const contacts = process.argv.slice(4).map((arg) => {
  const at = arg.lastIndexOf("=");
  return { label: arg.slice(0, at).trim(), phoneE164: arg.slice(at + 1) };
});
const apiUrl = (process.env.API_URL ?? "http://localhost:8080").replace(
  /\/+$/,
  "",
);
const e164 = /^\+[1-9][0-9]{6,14}$/;
if (
  !databaseUrl ||
  !jwtSecret ||
  !kidName ||
  !parentPhone ||
  !e164.test(parentPhone) ||
  contacts.some((c) => !c.label || !e164.test(c.phoneE164))
) {
  console.error(
    "Usage: DATABASE_URL=postgres://... JWT_SECRET=... tsx scripts/dev-contacts.ts <kid name> <parent +number> [Label=+number ...]",
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
  const send = async (method: string, path: string, body: unknown) => {
    const response = await fetch(`${apiUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(
        `the API said ${response.status} to ${method} ${path}: ${await response.text()}`,
      );
    }
  };
  await send("PATCH", `/v1/family/parents/${parent.id}`, {
    phoneE164: parentPhone,
  });
  await send("PUT", `/v1/kids/${kid.id}/contacts`, { contacts });
  const names = contacts.map((c) => c.label).join(", ") || "no contacts";
  console.log(
    `${parent.displayName} is on ${parentPhone}; ${kid.name} can call ${parent.displayName} and ${names}.`,
  );
} finally {
  await pg.end();
}
