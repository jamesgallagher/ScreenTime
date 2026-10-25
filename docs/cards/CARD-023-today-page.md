# CARD-023: Today page and adjust dialog

| Field | Value |
|---|---|
| Card | CARD-023 |
| Title | Today page and adjust dialog |
| Size | M |
| Depends on | CARD-022 (merged to `main`) |
| Spec sections | docs/SPEC.md §7, §16.1, §16.4, §16.5 |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-023-today-page` |
| PR title | `CARD-023: Today page and adjust dialog` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first.

CARD-022 built the parent web app's skeleton in `web/` (package `@screentime/web`): React 19, Vite, TanStack Router and Query, Tailwind CSS v4 with the design tokens of SPEC §16.1 in `web/src/index.css`, shadcn/ui-style components in `web/src/components/ui`, the API client `api` in `web/src/lib/auth.tsx` (`api.get`, `api.post`, which throw `ApiError` with the server's message), sign-in, and the layout shell with placeholder pages. Imports inside `web/src` use the `@/` alias and have no file extension.

This card builds the first real page, **Today** (the `/` route), from APIs that already exist:

- `GET /v1/today` gives, for every kid, both pools (Screens, then Phone) with `allowanceMin`, `grantedMin`, `usedSec`, `remainingSec`, `locked`, `lockReason` (`out_of_time`, `bedtime`, `before_wake`), `overspendSec` and the pool's devices (`name`, `form`, `inUse`, `lastSeenAt`, `parentMode`).
- `POST /v1/kids/{kidId}/grants` with `{ id, pool, minutes }` adds or takes away time for today (a non-zero multiple of 15, from −1440 to 1440). The app makes the `id`, so sending it again changes nothing.
- `POST /v1/kids/{kidId}/lock-now` with `{ id, pool }` takes away what is left (409 with a message when the pool is already locked).

The page shows one card per kid (SPEC §16.4: avatar, name, a row per pool with a bar, and status chips) and an **adjust dialog** per pool: a Screens/Phone switch, a value that steps by 15 minutes from −4h to +8h (default +15m), quick amounts, a live preview ("Now 45m left → 1h 00m left"), an Add/Take away button, and **Lock now** with a confirm step. On Android the same thing is a wheel; on the web it is − and + buttons and quick amounts, which work with a mouse and a keyboard.

## 2. Goal

A signed-in parent opens http://localhost:5173 and sees, for each kid, the time used and left in both pools, refreshed every 30 seconds, and can add time, take time away or lock a pool from the dialog; the page updates at once after each change. The pure logic is covered by Vitest tests.

## 3. Out of scope

Do **not** do any of these in this card:

- No server change, no change to `packages/schemas`, and the contract stays the same.
- No new npm packages and no lockfile change. `pnpm-lock.yaml`, `pnpm-workspace.yaml` and every `package.json` stay unchanged.
- No notes on grants, no grant history list, no time requests on this page (the Inbox card, CARD-025, shows those), no SOS banner.
- No other page: Inbox, Kids, Settings and Admin stay placeholders.
- Do not run the shadcn CLI. Do not change any file that is not listed in section 5.
- Never commit `deploy/.env`, `web/dist/`, a real JWT secret, an SMTP key, a Firebase key, an FCM token or a device token.

## 4. Tech and versions

Unchanged from `main`: Node 24, pnpm 11, TypeScript ^5.9, Vitest ^3.2, React ^19.3.1, Vite ^7.3.7, @tanstack/react-query ^5.104.5, @tanstack/react-router ^1.170.46, Tailwind CSS ^4.3.3, radix-ui ^1.8.1 (its `Dialog` for the new dialog), lucide-react ^1.61.0. Nothing new to install.

`crypto.randomUUID()` makes the grant ids in the browser. It works on http://localhost and on https.

Docker Desktop must be running for the server's database tests (check: `docker version` prints a `Server:` section).

## 5. Files

Create or change exactly these files. Paths are relative to the repo root. Copy every code block exactly, character for character, blank lines included. This card is UTF-8; if you see `Â` or `â€` anywhere, you are reading it with the wrong encoding: open it as UTF-8, and do not report it as a card error. Some strings use characters that look like plain ones but are not: `−` (a real minus sign, U+2212) in `formatAdjust` and its tests, `→` (U+2192) in `adjustPreview`, and `·` (U+00B7) in the lock and parent-mode texts. Copy them exactly; do not replace them with `-`, `->` or `.`.

| File | Action |
|---|---|
| `web/src/lib/today.ts` | create (5.1) |
| `web/src/components/ui/dialog.tsx` | create (5.2) |
| `web/src/components/kid-avatar.tsx` | create (5.3) |
| `web/src/components/adjust-dialog.tsx` | create (5.4) |
| `web/src/pages/today.tsx` | create (5.5) |
| `web/src/router.tsx` | replace (5.6) |
| `web/test/today.test.ts` | create (5.7) |

That is 7 files.

### 5.1 `web/src/lib/today.ts`

The page's logic, with no React in it, so it can be tested: how a pool reads (text, bar, colour), the chips under a kid card, and the adjust helpers.

```typescript
import type { Pool, TodayDevice, TodayKid, TodayPool } from '@screentime/schemas';
import { formatDuration } from '@/lib/format';

export const POOL_NAMES: Record<Pool, string> = { screens: 'Screens', phone: 'Phone' };

/** Colour of a pool's bar and "left" text (docs/SPEC.md §16.1). */
export type Tone = 'ok' | 'warning' | 'critical' | 'locked';

export interface PoolView {
  /** "45m left", "Locked · bedtime". */
  status: string;
  /** "1h 15m used of 2h 00m". */
  detail: string;
  /** Share of today's time still left, 0 to 1: the bar's filled part. */
  fraction: number;
  tone: Tone;
}

const LOCK_TEXT = {
  out_of_time: 'Locked · out of time',
  bedtime: 'Locked · bedtime',
  before_wake: 'Locked · before wake-up',
} as const;

/** How one pool reads on a kid card: 15 minutes or less is amber, 5 or less orange. */
export function poolView(pool: TodayPool): PoolView {
  const totalSec = Math.max(0, (pool.allowanceMin + pool.grantedMin) * 60);
  const used = pool.usedSec < 60 ? null : `${formatDuration(pool.usedSec)} used`;
  const total = totalSec < 60 ? null : formatDuration(totalSec);
  const detail = total === null ? (used ?? 'No time today') : used === null ? `Nothing used of ${total}` : `${used} of ${total}`;
  if (pool.locked) {
    return { status: LOCK_TEXT[pool.lockReason ?? 'out_of_time'], detail, fraction: 0, tone: 'locked' };
  }
  const fraction = totalSec > 0 ? Math.min(1, Math.max(0, pool.remainingSec / totalSec)) : 0;
  const tone: Tone = pool.remainingSec <= 5 * 60 ? 'critical' : pool.remainingSec <= 15 * 60 ? 'warning' : 'ok';
  return { status: `${formatDuration(pool.remainingSec)} left`, detail, fraction, tone };
}

export interface Chip {
  text: string;
  tone: 'neutral' | 'primary' | 'warning';
}

const FORM_NAMES = { phone: 'phone', tablet: 'tablet', pc: 'PC' } as const;
/** A device silent this long reads as offline, as in the server's sweep (docs/SPEC.md §8.5). */
const OFFLINE_AFTER_MS = 6 * 60 * 60 * 1000;

function hoursText(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  return hours >= 48 ? `${Math.floor(hours / 24)}d` : `${hours}h`;
}

function deviceChips(device: TodayDevice, now: Date): Chip[] {
  const chips: Chip[] = [];
  if (device.inUse) chips.push({ text: `Using ${device.name} now`, tone: 'primary' });
  if (device.parentMode) {
    const { endsAt } = device.parentMode;
    const left = endsAt ? Math.max(1, Math.ceil((new Date(endsAt).getTime() - now.getTime()) / 60_000)) : null;
    chips.push({
      text: left === null ? `Parent mode on ${device.name}` : `Parent mode on ${device.name} · ${left} min`,
      tone: 'neutral',
    });
  }
  if (!device.inUse && device.lastSeenAt) {
    const silent = now.getTime() - new Date(device.lastSeenAt).getTime();
    if (silent >= OFFLINE_AFTER_MS) chips.push({ text: `${device.name} offline ${hoursText(silent)}`, tone: 'neutral' });
  }
  return chips;
}

/**
 * The chips under a kid card (docs/SPEC.md §16.4): what is in use, parent mode, devices silent for 6 hours,
 * and time used beyond the limit while a device was offline. A device in both pools is listed once.
 */
export function kidChips(kid: TodayKid, now: Date): Chip[] {
  const seen = new Set<string>();
  const chips: Chip[] = [];
  for (const pool of kid.pools) {
    for (const device of pool.devices) {
      if (seen.has(device.id)) continue;
      seen.add(device.id);
      chips.push(...deviceChips(device, now));
    }
  }
  for (const pool of kid.pools) {
    if (pool.overspendSec >= 60) {
      chips.push({
        text: `${POOL_NAMES[pool.pool]}: ${formatDuration(pool.overspendSec)} over (a device was offline)`,
        tone: 'warning',
      });
    }
  }
  return chips;
}

/** Adjustments in 15-minute steps from −4h to +8h, as on the parent app's roller (docs/SPEC.md §16.4). */
export const ADJUST_STEP = 15;
export const ADJUST_MIN = -240;
export const ADJUST_MAX = 480;

export function clampAdjust(minutes: number): number {
  return Math.min(ADJUST_MAX, Math.max(ADJUST_MIN, Math.round(minutes / ADJUST_STEP) * ADJUST_STEP));
}

/** "+15m", "+1h", "+1h 30m", "−45m" (a real minus sign; whole hours without "00m", for short buttons). */
export function formatAdjust(minutes: number): string {
  const sign = minutes < 0 ? '−' : '+';
  const abs = Math.abs(minutes);
  return abs % 60 === 0 && abs > 0 ? `${sign}${abs / 60}h` : `${sign}${formatDuration(abs * 60)}`;
}

/**
 * "Now 45m left → 1h 00m left". After bedtime or when out of time the pool has nothing left, so a grant
 * gives exactly its own minutes (docs/SPEC.md §7). The server's answer is what counts; this is a preview.
 */
export function adjustPreview(pool: TodayPool, minutes: number): string {
  const now = pool.locked ? 'Now locked' : `Now ${formatDuration(pool.remainingSec)} left`;
  const after = Math.max(0, (pool.locked ? 0 : pool.remainingSec) + minutes * 60);
  return `${now} → ${after < 60 ? 'locked' : `${formatDuration(after)} left`}`;
}
```

### 5.2 `web/src/components/ui/dialog.tsx`

A shadcn/ui-style dialog on radix `Dialog`, themed with the tokens: centred, 28 px radius, a close button in the top right corner, the width of the screen minus 16 px each side on phones and 448 px at most.

```tsx
import { Dialog as DialogPrimitive } from 'radix-ui';
import { X } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** shadcn/ui dialog: centred, 28 px radius, a close button in the corner; full width on phones. */
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({ className, children, ...props }: ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay data-slot="dialog-overlay" className="fixed inset-0 z-50 bg-black/40" />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        aria-describedby={undefined}
        className={cn(
          'fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-5 overflow-y-auto rounded-[28px] border border-outline bg-surface p-6 shadow-xl outline-none',
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          className="absolute top-4 right-4 flex size-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-variant hover:text-on-surface"
          aria-label="Close"
        >
          <X className="size-5" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title data-slot="dialog-title" className={cn('pr-10 text-lg font-semibold', className)} {...props} />;
}

export function DialogDescription({ className, ...props }: ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description data-slot="dialog-description" className={cn('text-sm text-muted', className)} {...props} />;
}
```

### 5.3 `web/src/components/kid-avatar.tsx`

```tsx
import { cn } from '@/lib/utils';

/** A circle in the kid's colour with the first letter of their name (docs/SPEC.md §16.4). */
export function KidAvatar({ name, color, className }: { name: string; color: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('flex size-10 shrink-0 items-center justify-center rounded-full text-base font-semibold text-white', className)}
      style={{ backgroundColor: color }}
    >
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}
```

### 5.4 `web/src/components/adjust-dialog.tsx`

The dialog. Its body is a separate component that mounts fresh every time the dialog opens, so it always starts at +15m and makes new request ids.

```tsx
import type { Grant, Pool, TodayKid } from '@screentime/schemas';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Lock, Minus, Plus } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ApiError } from '@/lib/api';
import { api } from '@/lib/auth';
import { formatDuration } from '@/lib/format';
import {
  ADJUST_MAX,
  ADJUST_MIN,
  ADJUST_STEP,
  adjustPreview,
  clampAdjust,
  formatAdjust,
  POOL_NAMES,
} from '@/lib/today';
import { cn } from '@/lib/utils';

const QUICK = [15, 30, 60, 120];

function messageOf(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong. Try again.';
}

function PoolSwitch({ value, onChange }: { value: Pool; onChange: (pool: Pool) => void }) {
  return (
    <div role="radiogroup" aria-label="Pool" className="grid grid-cols-2 gap-1 rounded-full bg-surface-variant p-1">
      {(['screens', 'phone'] as const).map((pool) => (
        <button
          key={pool}
          type="button"
          role="radio"
          aria-checked={value === pool}
          onClick={() => onChange(pool)}
          className={cn(
            'h-10 rounded-full text-sm font-medium text-muted transition-colors',
            value === pool && 'bg-surface text-on-surface shadow-sm',
          )}
        >
          {POOL_NAMES[pool]}
        </button>
      ))}
    </div>
  );
}

/** The dialog's body: mounted fresh each time it opens, so it starts at +15m with new request ids. */
function AdjustBody({ kid, initialPool, onDone }: { kid: TodayKid; initialPool: Pool; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [pool, setPool] = useState<Pool>(initialPool);
  const [minutes, setMinutes] = useState(ADJUST_STEP);
  const [confirmLock, setConfirmLock] = useState(false);
  // Made once per opening: a retry after a lost answer sends the same id and cannot add the time twice.
  const [grantId] = useState(() => crypto.randomUUID());
  const [lockId] = useState(() => crypto.randomUUID());
  const today = kid.pools.find((p) => p.pool === pool);

  const done = () => {
    void queryClient.invalidateQueries({ queryKey: ['today'] });
    onDone();
  };
  const grant = useMutation({
    mutationFn: () => api.post<Grant>(`/v1/kids/${kid.id}/grants`, { id: grantId, pool, minutes }),
    onSuccess: done,
  });
  const lockNow = useMutation({
    mutationFn: () => api.post<Grant>(`/v1/kids/${kid.id}/lock-now`, { id: lockId, pool }),
    onSuccess: done,
  });
  const busy = grant.isPending || lockNow.isPending;
  const error = grant.error ?? lockNow.error;

  if (!today) return null;

  if (confirmLock) {
    return (
      <>
        <DialogTitle>
          Lock {POOL_NAMES[pool]} for {kid.name} now?
        </DialogTitle>
        <DialogDescription>
          This takes away the {formatDuration(today.remainingSec)} left today. {kid.name} can still ask for more time.
        </DialogDescription>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {messageOf(error)}
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Button variant="outline" disabled={busy} onClick={() => setConfirmLock(false)}>
            Cancel
          </Button>
          <Button variant="danger" disabled={busy} onClick={() => lockNow.mutate()}>
            {lockNow.isPending ? <Loader2 className="animate-spin" /> : <Lock />}
            Lock now
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      <DialogTitle>Adjust time for {kid.name}</DialogTitle>
      <PoolSwitch
        value={pool}
        onChange={(p) => {
          setPool(p);
          grant.reset();
        }}
      />

      <div className="flex items-center justify-between gap-4">
        <Button
          variant="outline"
          size="icon"
          aria-label="15 minutes less"
          disabled={minutes <= ADJUST_MIN}
          onClick={() => setMinutes((m) => clampAdjust(m - ADJUST_STEP))}
        >
          <Minus />
        </Button>
        <div className="text-center">
          <p
            className={cn('text-4xl font-semibold tabular-nums', minutes < 0 && 'text-danger')}
            aria-live="polite"
            data-testid="adjust-value"
          >
            {minutes === 0 ? '0m' : formatAdjust(minutes)}
          </p>
          <p className="mt-1 text-sm text-muted">{minutes < 0 ? 'Take away' : 'Add'} today only</p>
        </div>
        <Button
          variant="outline"
          size="icon"
          aria-label="15 minutes more"
          disabled={minutes >= ADJUST_MAX}
          onClick={() => setMinutes((m) => clampAdjust(m + ADJUST_STEP))}
        >
          <Plus />
        </Button>
      </div>

      <div className="flex flex-wrap justify-center gap-2">
        {QUICK.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => setMinutes(q)}
            className={cn(
              'h-9 rounded-full border border-outline px-4 text-sm font-medium transition-colors hover:bg-surface-variant',
              minutes === q && 'border-primary bg-primary/10 text-primary',
            )}
          >
            {formatAdjust(q)}
          </button>
        ))}
      </div>

      <p className="text-center text-sm text-muted">{adjustPreview(today, minutes)}</p>

      {error && (
        <p role="alert" className="text-center text-sm text-danger">
          {messageOf(error)}
        </p>
      )}

      <Button disabled={busy || minutes === 0} onClick={() => grant.mutate()}>
        {grant.isPending && <Loader2 className="animate-spin" />}
        {minutes < 0 ? `Take away ${formatDuration(-minutes * 60)}` : `Add ${formatDuration(Math.max(0, minutes) * 60)}`}
      </Button>
      <Button
        variant="link"
        className="self-center text-danger"
        disabled={busy || today.locked}
        onClick={() => {
          lockNow.reset();
          setConfirmLock(true);
        }}
      >
        {today.locked ? `${POOL_NAMES[pool]} is already locked` : `Lock ${POOL_NAMES[pool]} now`}
      </Button>
    </>
  );
}

/** docs/SPEC.md §16.4 adjust sheet, as a dialog: pool, ±15-minute steps from −4h to +8h, a preview, Apply, Lock now. */
export function AdjustDialog({
  kid,
  pool,
  onClose,
}: {
  kid: TodayKid | null;
  pool: Pool;
  onClose: () => void;
}) {
  return (
    <Dialog open={kid !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>{kid && <AdjustBody kid={kid} initialPool={pool} onDone={onClose} />}</DialogContent>
    </Dialog>
  );
}
```

### 5.5 `web/src/pages/today.tsx`

The page: `useToday` (TanStack Query, key `['today']`, every 30 seconds), the kid cards, and the loading, error and no-kids states.

```tsx
import type { Pool, Today, TodayKid, TodayPool } from '@screentime/schemas';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { RefreshCw, SlidersHorizontal, Users } from 'lucide-react';
import { useState } from 'react';
import { AdjustDialog } from '@/components/adjust-dialog';
import { KidAvatar } from '@/components/kid-avatar';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { api } from '@/lib/auth';
import { type Chip, kidChips, POOL_NAMES, poolView, type Tone } from '@/lib/today';
import { cn } from '@/lib/utils';

/** Refreshed every 30 seconds while the page is open, and at once after an adjustment. */
export function useToday() {
  return useQuery({ queryKey: ['today'], queryFn: () => api.get<Today>('/v1/today'), refetchInterval: 30_000 });
}

const BAR: Record<Tone, string> = { ok: 'bg-primary', warning: 'bg-warning', critical: 'bg-critical', locked: 'bg-muted' };
const STATUS: Record<Tone, string> = {
  ok: 'text-on-surface',
  warning: 'text-warning',
  critical: 'text-critical',
  locked: 'text-muted',
};
const CHIP: Record<Chip['tone'], string> = {
  neutral: 'bg-surface-variant text-muted',
  primary: 'bg-primary/10 text-primary',
  warning: 'bg-warning/15 text-warning',
};

/** "Sunday 26 October" for the family's local date (YYYY-MM-DD). */
function longDate(date: string): string {
  return new Intl.DateTimeFormat('en-AU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

function PoolRow({ kid, pool, onAdjust }: { kid: TodayKid; pool: TodayPool; onAdjust: () => void }) {
  const view = poolView(pool);
  const name = POOL_NAMES[pool.pool];
  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm font-medium">{name}</span>
          <span className={cn('text-sm font-semibold tabular-nums', STATUS[view.tone])}>{view.status}</span>
        </div>
        <div
          className="mt-2 h-2.5 overflow-hidden rounded-full bg-surface-variant"
          role="progressbar"
          aria-label={`${name} time left`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(view.fraction * 100)}
        >
          <div className={cn('h-full rounded-full transition-all', BAR[view.tone])} style={{ width: `${view.fraction * 100}%` }} />
        </div>
        <p className="mt-1.5 text-xs text-muted tabular-nums">{view.detail}</p>
      </div>
      <Button variant="outline" size="icon" className="size-10" aria-label={`Adjust ${name} for ${kid.name}`} onClick={onAdjust}>
        <SlidersHorizontal />
      </Button>
    </div>
  );
}

function KidCard({ kid, now, onAdjust }: { kid: TodayKid; now: Date; onAdjust: (pool: Pool) => void }) {
  const chips = kidChips(kid, now);
  return (
    <Card>
      <CardContent className="flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <KidAvatar name={kid.name} color={kid.avatarColor} />
          <h2 className="text-lg font-semibold">{kid.name}</h2>
        </div>
        {kid.pools.map((pool) => (
          <PoolRow key={pool.pool} kid={kid} pool={pool} onAdjust={() => onAdjust(pool.pool)} />
        ))}
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {chips.map((chip) => (
              <span key={chip.text} className={cn('rounded-full px-3 py-1 text-xs font-medium', CHIP[chip.tone])}>
                {chip.text}
              </span>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LoadingCards() {
  return (
    <div className="grid gap-4 md:grid-cols-2" aria-label="Loading">
      {[0, 1].map((i) => (
        <Card key={i} className="h-64 animate-pulse bg-surface-variant/50" />
      ))}
    </div>
  );
}

/** docs/SPEC.md §16.4 and §16.5: one card per kid with both pools, status chips and an adjust button per pool. */
export function TodayPage() {
  const today = useToday();
  const [adjusting, setAdjusting] = useState<{ kidId: string; pool: Pool } | null>(null);
  const data = today.data;
  const now = data ? new Date(data.serverTime) : new Date();
  const adjustKid = data?.kids.find((k) => k.id === adjusting?.kidId) ?? null;

  return (
    <>
      <PageHeader title="Today" description={data ? longDate(data.date) : 'Time used and left for each kid.'} />
      {today.isError && !data ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <p className="text-sm text-danger" role="alert">
              {today.error instanceof ApiError ? today.error.message : 'Something went wrong. Try again.'}
            </p>
            <Button variant="outline" onClick={() => void today.refetch()}>
              <RefreshCw />
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : !data ? (
        <LoadingCards />
      ) : data.kids.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-surface-variant text-muted">
              <Users className="size-6" />
            </span>
            <p className="font-medium">No kids yet</p>
            <p className="max-w-sm text-sm text-muted">Add your kids and their devices on the Kids page.</p>
            <Button asChild variant="outline">
              <Link to="/kids">Go to Kids</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.kids.map((kid) => (
            <KidCard key={kid.id} kid={kid} now={now} onAdjust={(pool) => setAdjusting({ kidId: kid.id, pool })} />
          ))}
        </div>
      )}
      <AdjustDialog kid={adjustKid} pool={adjusting?.pool ?? 'screens'} onClose={() => setAdjusting(null)} />
    </>
  );
}
```

### 5.6 `web/src/router.tsx`

The same as before, except it imports `TodayPage` and the `/` route uses it instead of the "Coming soon" placeholder.

```tsx
import {
  createRootRoute,
  createRoute,
  createRouter,
  Navigate,
  Outlet,
  useRouterState,
} from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { useAuth } from '@/lib/auth';
import { ComingSoon } from '@/pages/coming-soon';
import { NotFoundPage } from '@/pages/not-found';
import { SignInPage } from '@/pages/sign-in';
import { TodayPage } from '@/pages/today';

function FullScreenSpinner() {
  return (
    <div className="flex min-h-dvh items-center justify-center text-muted" aria-label="Loading">
      <Loader2 className="size-8 animate-spin" />
    </div>
  );
}

/** Every page but sign-in: signed-out visitors go to /sign-in; a super admin with no family only has /admin. */
function SignedInLayout() {
  const auth = useAuth();
  const path = useRouterState({ select: (s) => s.location.pathname });
  if (auth.status === 'loading') return <FullScreenSpinner />;
  if (auth.status === 'signedOut') return <Navigate to="/sign-in" />;
  if (!auth.me.family && path !== '/admin') return <Navigate to="/admin" />;
  return (
    <AppShell me={auth.me}>
      <Outlet />
    </AppShell>
  );
}

function AdminOnly() {
  const auth = useAuth();
  if (auth.status !== 'signedIn' || !auth.me.roles.includes('superadmin')) return <Navigate to="/" />;
  return <ComingSoon title="Admin" description="Families on this server." />;
}

const rootRoute = createRootRoute({ component: Outlet, notFoundComponent: NotFoundPage });

const signInRoute = createRoute({ getParentRoute: () => rootRoute, path: '/sign-in', component: SignInPage });

const appRoute = createRoute({ getParentRoute: () => rootRoute, id: 'app', component: SignedInLayout });

const todayRoute = createRoute({ getParentRoute: () => appRoute, path: '/', component: TodayPage });
const inboxRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/inbox',
  component: () => <ComingSoon title="Inbox" description="Requests, messages and events." />,
});
const kidsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/kids',
  component: () => <ComingSoon title="Kids" description="Schedules, devices and contacts." />,
});
const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings',
  component: () => <ComingSoon title="Settings" description="Notifications, presets, parents and the parent code." />,
});
const adminRoute = createRoute({ getParentRoute: () => appRoute, path: '/admin', component: AdminOnly });

const routeTree = rootRoute.addChildren([
  signInRoute,
  appRoute.addChildren([todayRoute, inboxRoute, kidsRoute, settingsRoute, adminRoute]),
]);

export const router = createRouter({ routeTree, defaultPreload: 'intent' });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
```

### 5.7 `web/test/today.test.ts`

```typescript
import type { TodayDevice, TodayKid, TodayPool } from '@screentime/schemas';
import { describe, expect, it } from 'vitest';
import { adjustPreview, clampAdjust, formatAdjust, kidChips, poolView } from '@/lib/today';

const NOW = new Date('2026-10-26T06:00:00Z');

function pool(over: Partial<TodayPool> = {}): TodayPool {
  return {
    pool: 'screens',
    allowanceMin: 120,
    grantedMin: 0,
    usedSec: 75 * 60,
    remainingSec: 45 * 60,
    locked: false,
    lockReason: null,
    nextLockAt: null,
    overspendSec: 0,
    devices: [],
    ...over,
  };
}

function device(over: Partial<TodayDevice> = {}): TodayDevice {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Pixel 7',
    form: 'phone',
    inUse: false,
    lastSeenAt: '2026-10-26T05:59:00Z',
    parentMode: null,
    ...over,
  };
}

describe('poolView', () => {
  it('shows time left, time used and the share left', () => {
    expect(poolView(pool())).toEqual({
      status: '45m left',
      detail: '1h 15m used of 2h 00m',
      fraction: 0.375,
      tone: 'ok',
    });
  });

  it('turns amber at 15 minutes and orange at 5', () => {
    expect(poolView(pool({ remainingSec: 15 * 60 })).tone).toBe('warning');
    expect(poolView(pool({ remainingSec: 5 * 60 + 1 })).tone).toBe('warning');
    expect(poolView(pool({ remainingSec: 5 * 60 })).tone).toBe('critical');
    expect(poolView(pool({ remainingSec: 30 })).status).toBe('less than a minute left');
  });

  it('counts grants in the total and shows why a pool is locked', () => {
    expect(poolView(pool({ grantedMin: 30, usedSec: 0, remainingSec: 150 * 60 })).detail).toBe('Nothing used of 2h 30m');
    expect(poolView(pool({ locked: true, lockReason: 'bedtime', remainingSec: 0 }))).toEqual({
      status: 'Locked · bedtime',
      detail: '1h 15m used of 2h 00m',
      fraction: 0,
      tone: 'locked',
    });
    expect(poolView(pool({ locked: true, lockReason: 'out_of_time', remainingSec: 0 })).status).toBe('Locked · out of time');
    expect(poolView(pool({ locked: true, lockReason: 'before_wake', remainingSec: 0 })).status).toBe(
      'Locked · before wake-up',
    );
    expect(poolView(pool({ allowanceMin: 0, usedSec: 0, remainingSec: 0, locked: true, lockReason: 'out_of_time' })).detail).toBe(
      'No time today',
    );
  });
});

describe('kidChips', () => {
  const kid = (pools: TodayPool[]): TodayKid => ({ id: 'k', name: 'Alex', avatarColor: '#0F766E', pools });

  it('lists devices in use, parent mode, devices silent for 6 hours and overspend', () => {
    const pc = device({ id: 'pc', name: 'Alex on Desktop', form: 'pc', inUse: true });
    const tablet = device({ id: 'tab', name: 'XPPen', form: 'tablet', lastSeenAt: '2026-10-25T23:00:00Z' });
    const phone = device({
      id: 'ph',
      parentMode: { endsAt: '2026-10-26T06:09:30Z', byName: 'Dad' },
    });
    const chips = kidChips(
      kid([pool({ devices: [pc, tablet], overspendSec: 12 * 60 }), pool({ pool: 'phone', devices: [phone] })]),
      NOW,
    );
    expect(chips).toEqual([
      { text: 'Using Alex on Desktop now', tone: 'primary' },
      { text: 'XPPen offline 7h', tone: 'neutral' },
      { text: 'Parent mode on Pixel 7 · 10 min', tone: 'neutral' },
      { text: 'Screens: 12m over (a device was offline)', tone: 'warning' },
    ]);
  });

  it('says nothing about a device seen lately, never seen, or a short overspend', () => {
    const recent = device({ lastSeenAt: '2026-10-26T00:30:00Z' });
    const never = device({ id: 'n', lastSeenAt: null });
    expect(kidChips(kid([pool({ devices: [recent, never], overspendSec: 59 })]), NOW)).toEqual([]);
  });

  it('shows parent mode with no end, and days for a long silence', () => {
    const chips = kidChips(
      kid([
        pool({
          devices: [
            device({ parentMode: { endsAt: null, byName: 'Mum' }, lastSeenAt: '2026-10-23T06:00:00Z' }),
          ],
        }),
      ]),
      NOW,
    );
    expect(chips.map((c) => c.text)).toEqual(['Parent mode on Pixel 7', 'Pixel 7 offline 3d']);
  });
});

describe('adjusting', () => {
  it('keeps to 15-minute steps from −4h to +8h', () => {
    expect(clampAdjust(20)).toBe(15);
    expect(clampAdjust(-300)).toBe(-240);
    expect(clampAdjust(600)).toBe(480);
  });

  it('writes signed amounts', () => {
    expect(formatAdjust(15)).toBe('+15m');
    expect(formatAdjust(60)).toBe('+1h');
    expect(formatAdjust(90)).toBe('+1h 30m');
    expect(formatAdjust(-120)).toBe('−2h');
    expect(formatAdjust(-45)).toBe('−45m');
  });

  it('previews the time left after the change', () => {
    expect(adjustPreview(pool(), 15)).toBe('Now 45m left → 1h 00m left');
    expect(adjustPreview(pool(), -60)).toBe('Now 45m left → locked');
    expect(adjustPreview(pool({ locked: true, lockReason: 'bedtime', remainingSec: 0 }), 30)).toBe('Now locked → 30m left');
  });
});
```

## 6. Detailed spec

### 6.1 How a pool reads (`poolView`)

- Total for today = `allowanceMin + grantedMin` minutes (never below 0).
- Not locked: the status is `"<time left> left"` (`formatDuration` from CARD-022: `45m`, `1h 05m`, `less than a minute`). Colour: teal (`primary`) above 15 minutes left, amber (`warning`) from 15 down to just over 5 minutes, orange (`critical`) at 5 minutes or less. The bar's filled part is the share of the total still left, in the same colour.
- Locked: `Locked · out of time`, `Locked · bedtime` or `Locked · before wake-up`, in muted grey, with an empty bar.
- The small line under the bar: `1h 15m used of 2h 00m`; `Nothing used of 2h 30m` when under a minute was used; `No time today` when the total is 0 and nothing was used.

### 6.2 Chips under a kid card (`kidChips`)

Each device once (a device can appear in both pools), in the order the API lists them:

- In use → `Using <device name> now` (teal tint).
- Parent mode on → `Parent mode on <device name> · <minutes left, rounded up> min`, or without the minutes when it has no end (grey).
- Not in use and last seen 6 hours ago or more (the same 6 hours as the server's offline sweep, SPEC §8.5) → `<device name> offline <hours>h`, or `<days>d` from 48 hours (grey). A device never seen gets no chip.

Then, for each pool with at least a minute of overspend: `<Pool>: <time> over (a device was offline)` (amber tint). The page uses `serverTime` from the answer as "now", so a wrong PC clock does not change the chips.

### 6.3 The adjust dialog

- Opened by the round button with the sliders icon at the right of each pool row (its label: `Adjust <Pool> for <kid>`), with that pool selected.
- Title `Adjust time for <kid>`. A pill switch Screens | Phone (radio buttons).
- The value in 36 px semibold: `+15m` to start. `−` and `+` round buttons step by 15 minutes, from `−4h` to `+8h` (each is disabled at its end). Negative values are red. Under it: `Add today only` or `Take away today only`.
- Quick amounts `+15m`, `+30m`, `+1h`, `+2h` set the value; the one equal to the value is highlighted.
- Preview line: `Now 45m left → 1h 00m left`, or `Now locked → 30m left` for a locked pool (a grant after bedtime gives exactly its own minutes, SPEC §7), or `→ locked` when nothing would be left.
- Main button: `Add 15m` or `Take away 15m`, disabled at `0m`. It sends `POST /v1/kids/{kidId}/grants`, then refreshes Today and closes. An error shows the server's message in red and keeps the dialog open.
- Under it a red text button `Lock <Pool> now`, or the disabled `<Pool> is already locked`. It switches the dialog to a confirm step: `Lock <Pool> for <kid> now?`, `This takes away the <time> left today. <kid> can still ask for more time.`, and two buttons, `Cancel` (back) and the red `Lock now` (sends `POST /v1/kids/{kidId}/lock-now`, refreshes, closes).
- The grant id and the lock id are made once each time the dialog opens: if an answer is lost and the parent presses again, the server sees the same id and does not add the time twice.

### 6.4 The page

- Heading `Today`, and under it the family's date, for example `Monday 26 October`.
- Kid cards in a grid: one column on phones, two from 768 px. Each card: a 40 px avatar circle in the kid's colour with the first letter in white, the name in 18 px semibold, then the two pool rows, then the chips.
- While loading: two pulsing grey cards. On an error with nothing to show yet: the error message in red and a `Try again` button. With no kids: `No kids yet`, `Add your kids and their devices on the Kids page.` and a `Go to Kids` button.
- The data refreshes every 30 seconds. A failed refresh keeps showing the last data.

## 7. Steps

All commands in PowerShell from `C:\Users\james\OpenCode\Testing\ScreenTime` unless stated otherwise.

1. Start from the latest `main` and create the branch:
   ```powershell
   git checkout main
   git pull origin main
   git checkout -b bob/card-023-today-page
   pnpm install --frozen-lockfile
   ```
   After the pull, `docs/cards/CARD-023-today-page.md` and `web/src/router.tsx` (CARD-022) must exist. If `web/src/router.tsx` is missing, CARD-022 is not on your `main`: run `git pull origin main` again, and if it is still missing, stop and ask James.
2. Create 5.1 to 5.5 and replace 5.6. Run `pnpm build` and `pnpm typecheck`. Commit: `CARD-023: add the Today page and the adjust dialog`.
3. Create 5.7. Run `pnpm --filter @screentime/web test`. Commit: `CARD-023: add Today tests`.
4. Run the acceptance checks in section 8.
5. Push and open the PR (section 10).
6. Wait for both CI checks to finish (`gh pr checks <number> --watch`).
7. Send James the handback report (section 12).

## 8. Acceptance criteria

Never put a real password, JWT secret, SMTP key, Firebase key, FCM token or device token in the PR or the handback.

- [ ] `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm typecheck` and `pnpm test` pass, and `git status --short pnpm-lock.yaml` is empty. `pnpm build` ends the web part with `✓ built in`. Without `TEST_DATABASE_URL`:
  - `packages/schemas`: `Tests  36 passed (36)`.
  - `packages/engine`: `Tests  27 passed (27)`.
  - `web`: `test/format.test.ts (3 tests)`, `test/api.test.ts (6 tests)`, `test/today.test.ts (9 tests)`, `Tests  18 passed (18)`.
  - `server`: `Tests  41 passed | 171 skipped (212)` (unchanged).
- [ ] `pnpm contract` leaves `git status --short contract` empty.
- [ ] The database tests still pass against PostgreSQL 18 (nothing on the server changed; this proves it). Use a local `deploy/.env` with throwaway values (this replaces any `deploy/.env` you have; it is git-ignored):
  ```powershell
  Set-Content deploy\.env "POSTGRES_PASSWORD=local-dev-only`nJWT_SECRET=local-dev-only-secret-at-least-32-characters`nSUPER_ADMIN_EMAIL=admin@example.com"
  docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v
  docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --wait db
  docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec db createdb -U screentime screentime_test
  $env:TEST_DATABASE_URL = "postgres://screentime:local-dev-only@localhost:5432/screentime_test"
  pnpm --filter @screentime/server test
  Remove-Item Env:TEST_DATABASE_URL
  docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v
  ```
  Output: `Tests  212 passed (212)`.
- [ ] The dev server serves the app. Run `pnpm dev:web` in a second PowerShell window and leave it running, then in the first window:
  ```powershell
  (curl.exe -s http://localhost:5173/) -match '<div id="root"></div>'
  (curl.exe -s http://localhost:5173/src/pages/today.tsx).Length -gt 1000
  ```
  Both print `True`. Stop `pnpm dev:web` with Ctrl+C. (Claude checks the page itself in a browser with test data after the PR is open; you do not need to sign in.)
- [ ] `git status` does **not** list `deploy/.env` or anything in `web/dist/`.
- [ ] Both GitHub Actions checks are green on the PR: **TypeScript / typecheck and test** and **TypeScript / docker compose smoke test**. Wait for them (`gh pr checks <number> --watch`) before you write the handback.
- [ ] Only the expected files changed. `git diff --name-only main...HEAD` lists exactly these 7 files (in any order):
  ```
  web/src/components/adjust-dialog.tsx
  web/src/components/kid-avatar.tsx
  web/src/components/ui/dialog.tsx
  web/src/lib/today.ts
  web/src/pages/today.tsx
  web/src/router.tsx
  web/test/today.test.ts
  ```

## 9. Tests

| File | What it asserts |
|---|---|
| `web/test/today.test.ts` | `poolView`: `45m left`, `1h 15m used of 2h 00m` and a 0.375 bar; amber at 15 minutes and just over 5, orange at 5, `less than a minute left`; grants count in the total (`Nothing used of 2h 30m`); the three lock texts with an empty grey bar; `No time today`. `kidChips`: a PC in use, a tablet silent 7 hours, parent mode with 9.5 minutes left shown as `10 min`, and 12 minutes of overspend, in that order; nothing for a device seen 5.5 hours ago, a device never seen, or 59 seconds of overspend; parent mode with no end and `3d` for 3 days of silence. Adjusting: 15-minute steps clamped to −4h and +8h; `+15m`, `+1h`, `+1h 30m`, `−45m`, `−2h`; the three preview texts. |

## 10. Git and pull request

1. Start from the latest `main` (step 1 above).
2. Commit in small logical commits (steps 2 and 3). Message format: `CARD-023: <what changed>`.
3. Before pushing, run every acceptance command again and make sure all pass.
4. Push: `git push -u origin bob/card-023-today-page`
5. Open a PR into `main` titled `CARD-023: Today page and adjust dialog`. Write the body to `$env:TEMP\pr-body.md` (outside the repo) and run `gh pr create --base main --head bob/card-023-today-page --title "CARD-023: Today page and adjust dialog" --body-file $env:TEMP\pr-body.md`. Body:
   ```markdown
   ## Card
   docs/cards/CARD-023-today-page.md

   ## What I did
   - ...

   ## Acceptance criteria
   - [x] install, build, typecheck, test — output: `...`
   - [x] contract unchanged
   - [x] database tests — output: `Tests  212 passed (212)`
   - [x] dev server serves the app — output: `True`, `True`
   - [x] deploy/.env and web/dist not tracked
   - [x] both CI checks green
   - [x] only expected files changed — output: 7 files

   ## Deviations from the card
   None. (Or list each one and why.)

   ## Blockers / questions
   None. (Or list them.)
   ```
   Only tick a box if you ran the command and saw that output. If you could not run something, leave the box empty and say why.
6. **Do not merge the PR.** Do not push to `main`. Claude reviews and merges.
7. Send James the handback report (section 12).

## 11. If something is wrong

If the card is wrong, impossible, or a command fails in a way you cannot fix within the card's scope: stop, do not improvise a different design, commit what works, and describe the problem under "Blockers / questions" in the PR. Paste the first error lines, not the whole log.

Known traps, and what to do:

- **`web/src/router.tsx` does not exist**: CARD-022 is not on your `main` yet. Stop and ask James.
- **A `formatAdjust` or preview test fails with `-45m` or `->`**: a special character was replaced when copying. Copy `−` (U+2212), `→` (U+2192) and `·` (U+00B7) exactly from the card; check with `Select-String -Path web\src\lib\today.ts -Pattern '−'`.
- **`curl` in PowerShell**: write `curl.exe`, not `curl` (in Windows PowerShell `curl` is a different command).
- **Every difference from the card is a deviation**, including how you ran a check (for example a different tool than the card's command). List it under "Deviations", even when the output was the same. In CARD-022 a check run with Node instead of the card's PowerShell was mentioned only in the output.
- **Blank lines and formatting**: copy them exactly too.
- **Different test data**: do not change values in the tests (names, times, amounts), even when another value would also pass. If you think one is wrong, say so under "Deviations".
- **A test fails**: do not change the test to make it pass, and do not skip it. Report it.

## 12. Handback report (required)

When the PR is open, your **last message to James** must be the handback report below, inside one fenced code block so James can copy it in one go and paste it to Claude. Claude checks every line of it against the PR, the CI logs and its own test run, so write only what you actually saw.

Rules:

- Every command line shows the **real** output you saw, copied, not retyped from the card. If you did not run a command, write `NOT RUN` and the reason. Never write the expected output from the card as if you saw it.
- "Deviations" lists every way your files differ from the card, including comments, wording and whitespace. If you think the card is wrong, quote the exact card line and say what is wrong with it.
- "Outside the repo" lists anything you changed on James's PC outside the repo folder (config files, global tools, environment variables). Write `None` if there was nothing.

The report, filled in:

````text
Claude, here is Bob's handback for CARD-023. Please review and merge if it is good.

CARD: CARD-023 Today page and adjust dialog
PR: <full PR URL>
Branch: bob/card-023-today-page
Head commit: <output of `git rev-parse HEAD`>

Files changed (`git diff --name-only main...HEAD`):
<paste the list>

Commands run, with real output:
- <command> -> <key output lines, or NOT RUN: reason>
- ...

Acceptance criteria:
- [x] <criterion> (ran it, output above)
- [ ] <criterion> NOT RUN: <reason>

Deviations from the card:
<None, or each one: file, what differs, why>

Outside the repo:
<None, or each change>

Questions / blockers:
<None, or each one>
````
