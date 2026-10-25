/** "1h 05m", "45m", "less than a minute" (docs/SPEC.md §16.1). Seconds are rounded down to whole minutes. */
export function formatDuration(seconds: number): string {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  if (minutes === 0) return 'less than a minute';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours === 0 ? `${rest}m` : `${hours}h ${String(rest).padStart(2, '0')}m`;
}

/** An instant as a time of day in the family time zone, 12-hour: "8:30 pm" (docs/SPEC.md §16.1). */
export function formatTimeOfDay(instant: Date | string, timeZone: string): string {
  const text = new Intl.DateTimeFormat('en-AU', { timeZone, hour: 'numeric', minute: '2-digit', hour12: true }).format(
    new Date(instant),
  );
  // Browsers differ in the space before "pm" (a narrow no-break space in newer ones) and its case.
  return text.replace(/\s+/g, ' ').toLowerCase();
}
