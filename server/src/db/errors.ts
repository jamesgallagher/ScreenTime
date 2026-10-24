/** True when PostgreSQL refused a row because of a unique constraint (code 23505). Drizzle wraps the error. */
export function isUniqueViolation(err: unknown): boolean {
  const code = (e: unknown) => (typeof e === 'object' && e !== null && 'code' in e ? e.code : undefined);
  return code(err) === '23505' || (typeof err === 'object' && err !== null && 'cause' in err && code(err.cause) === '23505');
}
