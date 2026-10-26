# CARD-025: Inbox and SOS banner

| Field | Value |
|---|---|
| Card | CARD-025 |
| Title | Inbox and SOS banner |
| Size | M |
| Depends on | CARD-024 (merged to `main`) |
| Spec sections | docs/SPEC.md §12.3, §13, §15, §16.4, §16.5 |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-025-inbox` |
| PR title | `CARD-025: Inbox and SOS banner` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first.

The parent web app is in `web/` (package `@screentime/web`): React 19, Vite, TanStack Router and Query, Tailwind CSS v4 with the design tokens of SPEC §16.1, shadcn/ui-style components in `web/src/components/ui`, and the API client `api` in `web/src/lib/auth.tsx`, which throws `ApiError` with the server's message. CARD-022 to CARD-024 built sign-in, the layout, **Today** and the **Kids** pages. Imports inside `web/src` use the `@/` alias and have no file extension.

This card replaces the **Inbox** placeholder and adds the **SOS banner**, all on APIs that already exist:

- **Waiting for you** at the top of the Inbox:
  - the kids' pending time requests (`GET /v1/requests?status=pending`), each with **Yes, 30m** (`POST /v1/requests/{id}/approve`), **No** (`/deny`) and **Other amount** (a dialog to give a different amount);
  - parent-mode requests ("I'm the parent" pressed on a kid device) from the last 10 minutes that nobody answered yet, each with a duration and **Start parent mode** (`POST /v1/parent-mode-requests/{id}/approve`) or **No** (`/deny`). There is no list endpoint for these: the app finds them in the event history.
- **History**: every event, newest first (`GET /v1/events`, 50 at a time, **Show older** for the next page), each in one plain sentence, for example `Dad added 30m of Screens for Sam` or `Message from Alex` with the message under it.
- **SOS banner**: while an SOS is active (`GET /v1/sos?active=true`, every 15 seconds), a red banner sits at the top of every page with the kid, the phone, the last position time, the battery, **Open map** (Google Maps), **I'm on it** (`POST /v1/sos/{id}/ack`) and **End SOS** with a confirm step (`POST /v1/sos/{id}/end`). The Android parent app rings the alarm; the web only shows the banner (SPEC §16.5).

The Settings page is the next card (CARD-025b), so Settings stays a placeholder here.

## 2. Goal

A signed-in parent opens the Inbox at http://localhost:5173/inbox, answers time requests and parent-mode requests, reads what happened, and sees and answers an active SOS from any page. The pure logic is covered by Vitest tests.

## 3. Out of scope

Do **not** do any of these in this card:

- No server change, no change to `packages/schemas`, and the contract stays the same.
- No new npm packages and no lockfile change. `pnpm-lock.yaml`, `pnpm-workspace.yaml` and every `package.json` stay as they are on `main`.
- No Settings page, no browser notifications or sounds, no SOS map inside the app, no "extend SOS" button, no filters on the history.
- Do not run the shadcn CLI. Do not change any file that is not listed in section 5.
- Never commit `deploy/.env`, `web/dist/`, a real JWT secret, an SMTP key, a Firebase key, an FCM token or a device token.

## 4. Tech and versions

Unchanged from `main`: Node 24, pnpm 11, TypeScript ^5.9, Vitest ^3.2, React ^19.3.1, Vite ^7.3.7, @tanstack/react-query ^5.104.5 (its `useInfiniteQuery` for the history pages), @tanstack/react-router ^1.170.46, Tailwind CSS ^4.3.3, radix-ui ^1.8.1, lucide-react ^1.61.0. Nothing new to install.

`pnpm build` still prints the Vite warning `(!) Some chunks are larger than 500 kB after minification`, as in CARD-024. That is expected.

Docker Desktop must be running for the server's database tests (check: `docker version` prints a `Server:` section).

## 5. Files

Create or change exactly these files. Paths are relative to the repo root. Copy every code block exactly, character for character, blank lines included. This card is UTF-8; if you see `Â` or `â€` anywhere, you are reading it with the wrong encoding: open it as UTF-8, and do not report it as a card error. Some strings use characters that look like plain ones but are not: `“` and `”` (curly double quotes, U+201C and U+201D) around the kids' words, `’` (U+2019) in one test message, and `·` (U+00B7) between facts. Copy them exactly; do not replace them with `"`, `'` or `.`.

| File | Action |
|---|---|
| `web/src/lib/inbox.ts` | create (5.1) |
| `web/src/components/sos-banner.tsx` | create (5.2) |
| `web/src/components/devices-panel.tsx` | replace (5.3) |
| `web/src/pages/inbox.tsx` | create (5.4) |
| `web/src/router.tsx` | replace (5.5) |
| `web/test/inbox.test.ts` | create (5.6) |

That is 6 files.

### 5.1 `web/src/lib/inbox.ts`

The Inbox's logic, with no React in it: one plain sentence per event kind (SPEC §13 lists every payload), the parent-mode requests still waiting, the time of an event, and the map link.

```typescript
import type { EventItem, Pool, SosLocation } from '@screentime/schemas';
import { formatDuration, formatTimeOfDay } from '@/lib/format';
import { POOL_NAMES } from '@/lib/today';

/** How an event reads in the history: the icon group and colour come from `tone`. */
export type EventTone = 'sos' | 'alert' | 'request' | 'message' | 'time' | 'info';

export interface EventView {
  text: string;
  /** A second line: the kid's own words, or a detail. */
  detail: string | null;
  tone: EventTone;
}

function str(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' ? value : null;
}

function num(payload: Record<string, unknown>, key: string): number | null {
  const value = payload[key];
  return typeof value === 'number' ? value : null;
}

function poolName(payload: Record<string, unknown>): string {
  const pool = str(payload, 'pool');
  return pool === 'screens' || pool === 'phone' ? POOL_NAMES[pool as Pool] : 'time';
}

function minutesText(minutes: number): string {
  return formatDuration(Math.abs(minutes) * 60);
}

/** “text” in curly quotes. */
function quoted(text: string): string {
  return `“${text}”`;
}

const TAMPER: Record<string, string> = {
  'tamper.clock': 'the clock was changed',
  'tamper.timezone': 'the time zone was changed',
  'tamper.tray_killed': 'the ScreenTime tray app was closed',
  'tamper.policy': 'a protected setting was changed',
  'tamper.call_blocked': 'a call was blocked',
};

/**
 * One line of the event history (docs/SPEC.md §13) in plain words. Payload fields are read defensively:
 * an event from a newer server, or with a missing field, still reads as something sensible.
 */
export function eventView(event: EventItem, timeZone: string): EventView {
  const p = event.payload;
  const kid = event.kidName ?? 'A kid';
  const device = event.deviceName ?? str(p, 'deviceName') ?? 'a device';
  const by = str(p, 'byName');
  switch (event.kind) {
    case 'time_request': {
      const reason = str(p, 'reason');
      return {
        text: `${kid} asked for ${minutesText(num(p, 'minutes') ?? 0)} more ${poolName(p)}`,
        detail: reason ? quoted(reason) : null,
        tone: 'request',
      };
    }
    case 'time_request.resolved':
      return p.approved === true
        ? { text: `${by ?? 'A parent'} said yes to ${kid}: ${minutesText(num(p, 'minutes') ?? 0)} more`, detail: null, tone: 'time' }
        : { text: `${by ?? 'A parent'} said no to ${kid}'s request`, detail: null, tone: 'info' };
    case 'grant.added': {
      const minutes = num(p, 'minutes') ?? 0;
      const who = by ?? 'A parent';
      if (p.lockNow === true) return { text: `${who} locked ${kid}'s ${poolName(p)}`, detail: null, tone: 'time' };
      return minutes >= 0
        ? { text: `${who} added ${minutesText(minutes)} of ${poolName(p)} for ${kid}`, detail: null, tone: 'time' }
        : { text: `${who} took away ${minutesText(minutes)} of ${poolName(p)} from ${kid}`, detail: null, tone: 'time' };
    }
    case 'kid_message':
      return { text: `Message from ${kid}`, detail: quoted(str(p, 'body') ?? ''), tone: 'message' };
    case 'parent_mode.request':
      return { text: `${kid} asked for parent mode on ${device}`, detail: null, tone: 'request' };
    case 'parent_mode.used': {
      const duration = num(p, 'durationMin');
      const length = duration === null ? 'until ended' : duration === 60 ? 'for 1 hour' : `for ${duration} min`;
      return {
        text: `Parent mode on ${device} ${length}`,
        detail: by ? `Started by ${by}` : 'Started with the parent code',
        tone: 'info',
      };
    }
    case 'parent_mode.denied':
      return { text: `${by ?? 'A parent'} said no to parent mode on ${device}`, detail: null, tone: 'info' };
    case 'parent_mode.ended':
      return { text: `Parent mode ended on ${device}`, detail: by ? `Ended by ${by}` : null, tone: 'info' };
    case 'sos.started':
      return { text: `SOS from ${kid}`, detail: `On ${device}`, tone: 'sos' };
    case 'sos.acked':
      return { text: `${by ?? 'A parent'} is on ${kid}'s SOS`, detail: null, tone: 'sos' };
    case 'sos.extended': {
      const until = str(p, 'autoStopAt');
      return {
        text: `${by ?? 'A parent'} kept ${kid}'s SOS on`,
        detail: until ? `Until ${formatTimeOfDay(until, timeZone)}` : null,
        tone: 'sos',
      };
    }
    case 'sos.ended': {
      const endedBy = str(p, 'endedBy');
      const text =
        endedBy === 'kid'
          ? `${kid} ended the SOS: safe`
          : endedBy === 'auto'
            ? `${kid}'s SOS stopped by itself`
            : `${by ?? 'A parent'} ended ${kid}'s SOS`;
      return { text, detail: null, tone: 'sos' };
    }
    case 'overspend':
      return {
        text: `${kid} went ${formatDuration(num(p, 'overspendSec') ?? 0)} over on ${poolName(p)}`,
        detail: `${device} was offline, so it could not know the time had run out`,
        tone: 'alert',
      };
    case 'device.offline': {
      const lastSeenAt = str(p, 'lastSeenAt');
      return {
        text: `${device} is offline`,
        detail: lastSeenAt ? `Last seen at ${formatTimeOfDay(lastSeenAt, timeZone)}` : null,
        tone: 'info',
      };
    }
    case 'device.enrolled':
      return { text: `${str(p, 'name') ?? device} was added for ${kid}`, detail: null, tone: 'info' };
    default:
      if (event.kind.startsWith('tamper.')) {
        const number = str(p, 'number');
        return {
          text: `${device}: ${TAMPER[event.kind] ?? 'something was tampered with'}`,
          detail: number ? `Number: ${number}` : null,
          tone: 'alert',
        };
      }
      return { text: event.kind, detail: null, tone: 'info' };
  }
}

/** Parent mode waits this long for an answer (docs/SPEC.md §12.3). */
const PARENT_MODE_WAIT_MS = 10 * 60_000;

/**
 * Parent-mode requests still waiting for an answer, newest first: a `parent_mode.request` from the last
 * 10 minutes with no later `parent_mode.used`, `.denied` or `.ended` for the same session. The server
 * keeps the real state, so an answer to a request that just ran out gets a 409 with a message.
 */
export function pendingParentModeRequests(events: EventItem[], now: Date): EventItem[] {
  const answered = new Set<string>();
  for (const e of events) {
    if (e.kind === 'parent_mode.used' || e.kind === 'parent_mode.denied' || e.kind === 'parent_mode.ended') {
      const id = str(e.payload, 'sessionId');
      if (id) answered.add(id);
    }
  }
  return events.filter((e) => {
    if (e.kind !== 'parent_mode.request') return false;
    const id = str(e.payload, 'requestId');
    return id !== null && !answered.has(id) && now.getTime() - new Date(e.at).getTime() < PARENT_MODE_WAIT_MS;
  });
}

function dayKey(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
}

/** "3:42 pm" today, "Yesterday, 3:42 pm", then "Sat 24 Oct, 3:42 pm", in the family time zone. */
export function whenText(at: string, now: Date, timeZone: string): string {
  const instant = new Date(at);
  const time = formatTimeOfDay(instant, timeZone);
  const day = dayKey(instant, timeZone);
  if (day === dayKey(now, timeZone)) return time;
  if (day === dayKey(new Date(now.getTime() - 86_400_000), timeZone)) return `Yesterday, ${time}`;
  const date = new Intl.DateTimeFormat('en-AU', { timeZone, weekday: 'short', day: 'numeric', month: 'short' })
    .format(instant)
    .replace(',', '');
  return `${date}, ${time}`;
}

/** A Google Maps link to a position; it opens the Maps app on phones. */
export function mapUrl(location: Pick<SosLocation, 'lat' | 'lng'>): string {
  return `https://www.google.com/maps/search/?api=1&query=${location.lat},${location.lng}`;
}
```

### 5.2 `web/src/components/sos-banner.tsx`

The banner. It uses a fixed red (`#DC2626`, the light theme's `danger`) in both themes, because the dark theme's lighter red is too pale behind white text.

```tsx
import type { Sos } from '@screentime/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, MapPin, Siren } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ApiError } from '@/lib/api';
import { api, useAuth } from '@/lib/auth';
import { formatTimeOfDay } from '@/lib/format';
import { mapUrl } from '@/lib/inbox';

/** Active SOS alerts, checked every 15 seconds on every page (docs/SPEC.md §16.5). */
export function useActiveSos(enabled = true) {
  return useQuery({
    queryKey: ['sos', 'active'],
    queryFn: () => api.get<Sos[]>('/v1/sos?active=true'),
    refetchInterval: 15_000,
    enabled,
  });
}

function messageOf(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong. Try again.';
}

// The light theme's danger red in both themes: the dark theme's lighter red is too pale for white text.
const RED = '#DC2626';

function SosAlert({ sos, parentId, timeZone }: { sos: Sos; parentId: string | null; timeZone: string }) {
  const queryClient = useQueryClient();
  const [confirmEnd, setConfirmEnd] = useState(false);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['sos'] });
    void queryClient.invalidateQueries({ queryKey: ['events'] });
  };
  const ack = useMutation({ mutationFn: () => api.post<Sos>(`/v1/sos/${sos.id}/ack`), onSuccess: refresh });
  const end = useMutation({
    mutationFn: () => api.post<Sos>(`/v1/sos/${sos.id}/end`),
    onSuccess: () => {
      setConfirmEnd(false);
      refresh();
    },
  });
  const mine = sos.acks.some((a) => a.parentId === parentId);
  const location = sos.lastLocation;
  const facts = [
    `Started ${formatTimeOfDay(sos.startedAt, timeZone)} on ${sos.deviceName}`,
    location ? `Last position ${formatTimeOfDay(location.at, timeZone)}` : 'No position yet',
    location?.batteryPct != null ? `Battery ${location.batteryPct}%` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const onIt = sos.acks.map((a) => a.byName).join(' and ');

  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-2xl p-4 text-white shadow-lg sm:flex-row sm:items-center"
      style={{ backgroundColor: RED }}
    >
      <span className="flex size-11 shrink-0 animate-pulse items-center justify-center rounded-full bg-white/20">
        <Siren className="size-6" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-lg font-semibold">SOS from {sos.kidName}</p>
        <p className="text-sm text-white/90">{facts}</p>
        {onIt && <p className="mt-1 text-sm font-medium">{onIt} on it</p>}
        {(ack.error || end.error) && <p className="mt-1 text-sm font-medium">{messageOf(ack.error ?? end.error)}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        {location && (
          <Button asChild variant="outline" size="sm" className="border-white/40 bg-white hover:bg-white/90"
            style={{ color: RED }}>
            <a href={mapUrl(location)} target="_blank" rel="noreferrer">
              <MapPin />
              Open map
            </a>
          </Button>
        )}
        {mine ? (
          <span className="inline-flex h-9 items-center gap-1.5 px-2 text-sm font-medium">
            <Check className="size-4" />
            You're on it
          </span>
        ) : (
          <Button
            size="sm"
            className="bg-white hover:bg-white/90"
            style={{ color: RED }}
            disabled={ack.isPending}
            onClick={() => ack.mutate()}
          >
            {ack.isPending && <Loader2 className="animate-spin" />}
            I'm on it
          </Button>
        )}
        <Button size="sm" variant="ghost" className="text-white hover:bg-white/15" onClick={() => setConfirmEnd(true)}>
          End SOS
        </Button>
      </div>
      <Dialog open={confirmEnd} onOpenChange={(o) => !o && setConfirmEnd(false)}>
        <DialogContent>
          <DialogTitle>End {sos.kidName}'s SOS?</DialogTitle>
          <DialogDescription>
            Only end it when you know {sos.kidName} is safe. Their phone stops sharing its position, and the other parents
            are told.
          </DialogDescription>
          {end.error && (
            <p role="alert" className="text-sm text-danger">
              {messageOf(end.error)}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Button variant="outline" disabled={end.isPending} onClick={() => setConfirmEnd(false)}>
              Cancel
            </Button>
            <Button variant="danger" disabled={end.isPending} onClick={() => end.mutate()}>
              {end.isPending && <Loader2 className="animate-spin" />}
              End SOS
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** A red banner at the top of every page while an SOS is active, with the map link (docs/SPEC.md §15, §16.5). */
export function SosBanner() {
  const auth = useAuth();
  const me = auth.status === 'signedIn' ? auth.me : null;
  // A super admin without a family has no SOS to see.
  const sos = useActiveSos(Boolean(me?.family));
  if (!me?.family || !sos.data?.length) return null;
  const timeZone = me.family.timezone;
  return (
    <div className="mb-6 flex flex-col gap-3">
      {sos.data.map((s) => (
        <SosAlert key={s.id} sos={s} parentId={me.parent?.id ?? null} timeZone={timeZone} />
      ))}
    </div>
  );
}
```

### 5.3 `web/src/components/devices-panel.tsx`

The same as before except one word: `DURATIONS` is now exported (`export const DURATIONS`), so the Inbox uses the same five parent-mode lengths.

```tsx
import type { Device, ParentModeDuration, TodayDevice } from '@screentime/schemas';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Loader2,
  Monitor,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  Smartphone,
  Tablet,
  Trash2,
} from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { AddDeviceDialog } from '@/components/add-device-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';
import { api } from '@/lib/auth';
import { lastSeenText } from '@/lib/kid';
import { POOL_NAMES } from '@/lib/today';
import { cn } from '@/lib/utils';
import { useDevices } from '@/pages/kids';
import { useToday } from '@/pages/today';

const ICONS = { phone: Smartphone, tablet: Tablet, pc: Monitor };

export const DURATIONS: { value: ParentModeDuration; label: string }[] = [
  { value: 2, label: '2 min' },
  { value: 5, label: '5 min' },
  { value: 15, label: '15 min' },
  { value: 60, label: '1 hour' },
  { value: null, label: 'Until I end it' },
];

function messageOf(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong. Try again.';
}

function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-sm text-danger">
      {messageOf(error)}
    </p>
  );
}

type Action = { kind: 'rename' | 'parentMode' | 'remove'; device: Device };

/** "Parent mode · 10 min" or "Parent mode · until ended". */
function parentModeText(parentMode: NonNullable<TodayDevice['parentMode']>, now: Date): string {
  if (!parentMode.endsAt) return 'Parent mode · until ended';
  const minutes = Math.max(1, Math.ceil((new Date(parentMode.endsAt).getTime() - now.getTime()) / 60_000));
  return `Parent mode · ${minutes} min`;
}

function RenameBody({ device, onDone }: { device: Device; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(device.name);
  const rename = useMutation({
    mutationFn: () => api.patch<Device>(`/v1/devices/${device.id}`, { name: name.trim() }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['devices'] });
      void queryClient.invalidateQueries({ queryKey: ['today'] });
      onDone();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) rename.mutate();
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <DialogTitle>Rename {device.name}</DialogTitle>
      <div className="flex flex-col gap-2">
        <Label htmlFor="device-name">Name</Label>
        <Input id="device-name" value={name} maxLength={40} autoComplete="off" onChange={(e) => setName(e.target.value)} />
      </div>
      <ErrorText error={rename.error} />
      <Button type="submit" disabled={rename.isPending || !name.trim()}>
        {rename.isPending && <Loader2 className="animate-spin" />}
        Save
      </Button>
    </form>
  );
}

function ParentModeBody({ device, onDone }: { device: Device; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [duration, setDuration] = useState<ParentModeDuration>(15);
  const start = useMutation({
    mutationFn: () => api.post(`/v1/devices/${device.id}/parent-mode`, { durationMin: duration }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['today'] });
      onDone();
    },
  });
  return (
    <>
      <DialogTitle>Parent mode on {device.name}</DialogTitle>
      <DialogDescription>
        {device.name} unlocks for a parent to use. Time in parent mode does not count, and the other parents are told.
      </DialogDescription>
      <div role="radiogroup" aria-label="How long" className="flex flex-wrap gap-2">
        {DURATIONS.map((d) => (
          <button
            key={d.label}
            type="button"
            role="radio"
            aria-checked={duration === d.value}
            onClick={() => setDuration(d.value)}
            className={cn(
              'h-10 rounded-full border border-outline px-4 text-sm font-medium transition-colors hover:bg-surface-variant',
              duration === d.value && 'border-primary bg-primary/10 text-primary',
            )}
          >
            {d.label}
          </button>
        ))}
      </div>
      <ErrorText error={start.error} />
      <Button disabled={start.isPending} onClick={() => start.mutate()}>
        {start.isPending ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
        Start parent mode
      </Button>
    </>
  );
}

function RemoveBody({ device, onDone }: { device: Device; onDone: () => void }) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => api.delete(`/v1/devices/${device.id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['devices'] });
      void queryClient.invalidateQueries({ queryKey: ['today'] });
      onDone();
    },
  });
  return (
    <>
      <DialogTitle>Remove {device.name}?</DialogTitle>
      <DialogDescription>
        It is signed out of ScreenTime and stops limiting time. To add it again you need a new code.
      </DialogDescription>
      <ErrorText error={remove.error} />
      <div className="grid grid-cols-2 gap-3">
        <Button variant="outline" disabled={remove.isPending} onClick={onDone}>
          Cancel
        </Button>
        <Button variant="danger" disabled={remove.isPending} onClick={() => remove.mutate()}>
          {remove.isPending ? <Loader2 className="animate-spin" /> : <Trash2 />}
          Remove
        </Button>
      </div>
    </>
  );
}

function DeviceRow({
  device,
  live,
  now,
  onAction,
}: {
  device: Device;
  live: TodayDevice | undefined;
  now: Date;
  onAction: (action: Action) => void;
}) {
  const queryClient = useQueryClient();
  const end = useMutation({
    mutationFn: () => api.delete(`/v1/devices/${device.id}/parent-mode`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['today'] }),
  });
  const Icon = ICONS[device.form];
  const parentMode = live?.parentMode ?? null;
  // The model is left out while it is still the name (a device's first name is its model).
  const model = device.model && !device.name.includes(device.model) ? device.model : null;
  const facts = [`${POOL_NAMES[device.pool]} time`, model, device.osVersion].filter(Boolean).join(' · ');

  return (
    <div className="flex items-center gap-4 border-t border-outline py-4 last:pb-0">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface-variant text-muted">
        <Icon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{device.name}</p>
        <p className="truncate text-sm text-muted">{facts}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
          {live?.inUse ? (
            <span className="rounded-full bg-primary/10 px-2.5 py-0.5 font-medium text-primary">In use now</span>
          ) : (
            <span className="text-muted">{lastSeenText(device.lastSeenAt, now)}</span>
          )}
          {parentMode && (
            <span className="rounded-full bg-surface-variant px-2.5 py-0.5 font-medium text-muted">
              {parentModeText(parentMode, now)}
            </span>
          )}
        </div>
        {end.error && <p className="mt-1 text-xs text-danger">{messageOf(end.error)}</p>}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`More for ${device.name}`}>
            {end.isPending ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {parentMode ? (
            <DropdownMenuItem onSelect={() => end.mutate()}>
              <ShieldOff />
              End parent mode
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => onAction({ kind: 'parentMode', device })}>
              <ShieldCheck />
              Parent mode…
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => onAction({ kind: 'rename', device })}>
            <Pencil />
            Rename…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem danger onSelect={() => onAction({ kind: 'remove', device })}>
            <Trash2 />
            Remove device…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** docs/SPEC.md §16.4 devices: name, form icon, last seen, Parent mode, rename, remove, and Add device. */
export function DevicesPanel({ kidId, kidName }: { kidId: string; kidName: string }) {
  const devices = useDevices();
  const today = useToday();
  const [action, setAction] = useState<Action | null>(null);
  const [adding, setAdding] = useState(false);
  const now = today.data ? new Date(today.data.serverTime) : new Date();
  const live = new Map<string, TodayDevice>();
  for (const pool of today.data?.kids.find((k) => k.id === kidId)?.pools ?? []) {
    for (const d of pool.devices) live.set(d.id, d);
  }
  const mine = devices.data?.filter((d) => d.kidId === kidId);
  const close = () => setAction(null);

  return (
    <>
      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Devices</h2>
              <p className="text-sm text-muted">Phones count as Phone time. Tablets and PCs share Screens time.</p>
            </div>
            <Button onClick={() => setAdding(true)}>
              <Plus />
              Add device
            </Button>
          </div>
          {devices.isError && !mine ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <p className="text-sm text-danger" role="alert">
                {messageOf(devices.error)}
              </p>
              <Button variant="outline" onClick={() => void devices.refetch()}>
                <RefreshCw />
                Try again
              </Button>
            </div>
          ) : !mine ? (
            <div className="h-24 animate-pulse rounded-xl bg-surface-variant/50" aria-label="Loading" />
          ) : mine.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-xl bg-surface-variant/60 py-8 text-center">
              <Smartphone className="size-6 text-muted" />
              <p className="text-sm text-muted">No devices yet. Add {kidName}'s phone, tablet or PC.</p>
            </div>
          ) : (
            <div>
              {mine.map((device) => (
                <DeviceRow key={device.id} device={device} live={live.get(device.id)} now={now} onAction={setAction} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={action !== null} onOpenChange={(o) => !o && close()}>
        <DialogContent>
          {action?.kind === 'rename' && <RenameBody device={action.device} onDone={close} />}
          {action?.kind === 'parentMode' && <ParentModeBody device={action.device} onDone={close} />}
          {action?.kind === 'remove' && <RemoveBody device={action.device} onDone={close} />}
        </DialogContent>
      </Dialog>
      <AddDeviceDialog
        open={adding}
        kidId={kidId}
        kidName={kidName}
        onClose={() => {
          setAdding(false);
          void today.refetch();
        }}
      />
    </>
  );
}
```

### 5.4 `web/src/pages/inbox.tsx`

```tsx
import type { EventItem, EventPage, ParentModeDuration, TimeRequest } from '@screentime/schemas';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Hand, Info, Loader2, MessageCircle, Minus, Plus, RefreshCw, ShieldAlert, ShieldCheck, Siren } from 'lucide-react';
import { useState } from 'react';
import { DURATIONS } from '@/components/devices-panel';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ApiError } from '@/lib/api';
import { api, useAuth } from '@/lib/auth';
import { formatDuration } from '@/lib/format';
import { type EventTone, eventView, pendingParentModeRequests, whenText } from '@/lib/inbox';
import { POOL_NAMES } from '@/lib/today';
import { cn } from '@/lib/utils';

const PAGE = 50;
const APPROVE_MIN = 15;
const APPROVE_MAX = 480;
const QUICK = [15, 30, 60, 120];

function messageOf(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong. Try again.';
}

/** The event history, newest first, 50 at a time; refreshed every 30 seconds (docs/SPEC.md §13). */
function useEvents() {
  return useInfiniteQuery({
    queryKey: ['events'],
    queryFn: ({ pageParam }) =>
      api.get<EventPage>(`/v1/events?limit=${PAGE}${pageParam ? `&before=${pageParam}` : ''}`),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextBefore,
    refetchInterval: 30_000,
  });
}

function usePendingRequests() {
  return useQuery({
    queryKey: ['requests', 'pending'],
    queryFn: () => api.get<TimeRequest[]>('/v1/requests?status=pending'),
    refetchInterval: 30_000,
  });
}

/** After an answer: the request list, the history and Today all change. */
function useRefreshAll() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['requests'] });
    void queryClient.invalidateQueries({ queryKey: ['events'] });
    void queryClient.invalidateQueries({ queryKey: ['today'] });
  };
}

const TONE: Record<EventTone, { icon: typeof Info; className: string }> = {
  sos: { icon: Siren, className: 'bg-danger/10 text-danger' },
  alert: { icon: ShieldAlert, className: 'bg-warning/15 text-warning' },
  request: { icon: Hand, className: 'bg-primary/10 text-primary' },
  message: { icon: MessageCircle, className: 'bg-primary/10 text-primary' },
  time: { icon: Clock, className: 'bg-surface-variant text-muted' },
  info: { icon: Info, className: 'bg-surface-variant text-muted' },
};

function ToneIcon({ tone }: { tone: EventTone }) {
  const { icon: Icon, className } = TONE[tone];
  return (
    <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-full', className)}>
      <Icon className="size-5" />
    </span>
  );
}

function ApproveBody({ request, onDone }: { request: TimeRequest; onDone: () => void }) {
  const refreshAll = useRefreshAll();
  const [minutes, setMinutes] = useState(request.minutes);
  const approve = useMutation({
    mutationFn: () => api.post<TimeRequest>(`/v1/requests/${request.id}/approve`, { minutes }),
    onSuccess: () => {
      refreshAll();
      onDone();
    },
  });
  const step = (delta: number) => setMinutes((m) => Math.min(APPROVE_MAX, Math.max(APPROVE_MIN, m + delta)));
  return (
    <>
      <DialogTitle>
        Give {request.kidName} more {POOL_NAMES[request.pool]}
      </DialogTitle>
      <DialogDescription>
        {request.kidName} asked for {formatDuration(request.minutes * 60)}. It counts for today only.
      </DialogDescription>
      <div className="flex items-center justify-between gap-4">
        <Button variant="outline" size="icon" aria-label="15 minutes less" disabled={minutes <= APPROVE_MIN} onClick={() => step(-15)}>
          <Minus />
        </Button>
        <p className="text-4xl font-semibold tabular-nums" aria-live="polite" data-testid="approve-value">
          {formatDuration(minutes * 60)}
        </p>
        <Button variant="outline" size="icon" aria-label="15 minutes more" disabled={minutes >= APPROVE_MAX} onClick={() => step(15)}>
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
            {formatDuration(q * 60)}
          </button>
        ))}
      </div>
      {approve.error && (
        <p role="alert" className="text-center text-sm text-danger">
          {messageOf(approve.error)}
        </p>
      )}
      <Button disabled={approve.isPending} onClick={() => approve.mutate()}>
        {approve.isPending && <Loader2 className="animate-spin" />}
        Give {formatDuration(minutes * 60)}
      </Button>
    </>
  );
}

function TimeRequestCard({ request, timeZone, now }: { request: TimeRequest; timeZone: string; now: Date }) {
  const refreshAll = useRefreshAll();
  const [choosing, setChoosing] = useState(false);
  const approve = useMutation({
    mutationFn: () => api.post<TimeRequest>(`/v1/requests/${request.id}/approve`, {}),
    onSuccess: refreshAll,
  });
  const deny = useMutation({ mutationFn: () => api.post<TimeRequest>(`/v1/requests/${request.id}/deny`), onSuccess: refreshAll });
  const busy = approve.isPending || deny.isPending;
  const error = approve.error ?? deny.error;
  const asked = formatDuration(request.minutes * 60);
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 gap-3">
          <ToneIcon tone="request" />
          <div className="min-w-0">
            <p className="font-semibold">
              {request.kidName} wants {asked} more {POOL_NAMES[request.pool]}
            </p>
            {request.reason && <p className="text-sm">“{request.reason}”</p>}
            <p className="text-xs text-muted">
              {request.deviceName} · {whenText(request.createdAt, now, timeZone)}
            </p>
            {error && <p className="mt-1 text-sm text-danger">{messageOf(error)}</p>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="link" size="sm" disabled={busy} onClick={() => setChoosing(true)}>
            Other amount
          </Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => deny.mutate()}>
            {deny.isPending && <Loader2 className="animate-spin" />}
            No
          </Button>
          <Button size="sm" disabled={busy} onClick={() => approve.mutate()}>
            {approve.isPending && <Loader2 className="animate-spin" />}
            Yes, {asked}
          </Button>
        </div>
      </CardContent>
      <Dialog open={choosing} onOpenChange={(o) => !o && setChoosing(false)}>
        <DialogContent>{choosing && <ApproveBody request={request} onDone={() => setChoosing(false)} />}</DialogContent>
      </Dialog>
    </Card>
  );
}

function ParentModeCard({ event, timeZone, now }: { event: EventItem; timeZone: string; now: Date }) {
  const refreshAll = useRefreshAll();
  const [duration, setDuration] = useState<ParentModeDuration>(15);
  const requestId = String(event.payload.requestId);
  const approve = useMutation({
    mutationFn: () => api.post(`/v1/parent-mode-requests/${requestId}/approve`, { durationMin: duration }),
    onSuccess: refreshAll,
  });
  const deny = useMutation({ mutationFn: () => api.post(`/v1/parent-mode-requests/${requestId}/deny`), onSuccess: refreshAll });
  const busy = approve.isPending || deny.isPending;
  const error = approve.error ?? deny.error;
  const device = event.deviceName ?? 'the device';
  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex gap-3">
          <ToneIcon tone="request" />
          <div className="min-w-0">
            <p className="font-semibold">
              {event.kidName ?? 'A kid'} asks for parent mode on {device}
            </p>
            <p className="text-sm text-muted">
              Someone pressed “I'm the parent” on {device}. Say yes only if a parent is there with it.
            </p>
            <p className="text-xs text-muted">{whenText(event.at, now, timeZone)}</p>
            {error && <p className="mt-1 text-sm text-danger">{messageOf(error)}</p>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label="How long" className="mr-auto flex flex-wrap gap-2">
            {DURATIONS.map((d) => (
              <button
                key={d.label}
                type="button"
                role="radio"
                aria-checked={duration === d.value}
                onClick={() => setDuration(d.value)}
                className={cn(
                  'h-9 rounded-full border border-outline px-3 text-sm font-medium transition-colors hover:bg-surface-variant',
                  duration === d.value && 'border-primary bg-primary/10 text-primary',
                )}
              >
                {d.label}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => deny.mutate()}>
            {deny.isPending && <Loader2 className="animate-spin" />}
            No
          </Button>
          <Button size="sm" disabled={busy} onClick={() => approve.mutate()}>
            {approve.isPending ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
            Start parent mode
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function EventRow({ event, timeZone, now }: { event: EventItem; timeZone: string; now: Date }) {
  const view = eventView(event, timeZone);
  return (
    <li className="flex gap-3 border-t border-outline py-3 first:border-t-0 first:pt-0 last:pb-0">
      <ToneIcon tone={view.tone} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{view.text}</p>
        {view.detail && <p className="text-sm text-muted">{view.detail}</p>}
      </div>
      <time dateTime={event.at} className="shrink-0 pt-0.5 text-xs text-muted tabular-nums">
        {whenText(event.at, now, timeZone)}
      </time>
    </li>
  );
}

/** docs/SPEC.md §16.4 and §16.5 Inbox: what waits for an answer at the top, then every event, newest first. */
export function InboxPage() {
  const auth = useAuth();
  const timeZone = (auth.status === 'signedIn' && auth.me.family?.timezone) || 'UTC';
  const events = useEvents();
  const requests = usePendingRequests();
  const now = new Date();
  const all = events.data?.pages.flatMap((p) => p.events) ?? [];
  const parentMode = pendingParentModeRequests(all, now);
  const waiting = (requests.data?.length ?? 0) + parentMode.length;

  return (
    <>
      <PageHeader title="Inbox" description="Requests, messages and everything that happened." />
      {waiting > 0 && (
        <section aria-labelledby="waiting" className="mb-8 flex flex-col gap-3">
          <h2 id="waiting" className="text-sm font-semibold text-muted">
            Waiting for you
          </h2>
          {parentMode.map((e) => (
            <ParentModeCard key={e.id} event={e} timeZone={timeZone} now={now} />
          ))}
          {requests.data?.map((r) => (
            <TimeRequestCard key={r.id} request={r} timeZone={timeZone} now={now} />
          ))}
        </section>
      )}
      <section aria-labelledby="history" className="flex flex-col gap-3">
        <h2 id="history" className="text-sm font-semibold text-muted">
          History
        </h2>
        {events.isError && !events.data ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
              <p className="text-sm text-danger" role="alert">
                {messageOf(events.error)}
              </p>
              <Button variant="outline" onClick={() => void events.refetch()}>
                <RefreshCw />
                Try again
              </Button>
            </CardContent>
          </Card>
        ) : !events.data ? (
          <Card className="h-64 animate-pulse bg-surface-variant/50" aria-label="Loading" />
        ) : all.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
              <span className="flex size-12 items-center justify-center rounded-full bg-surface-variant text-muted">
                <MessageCircle className="size-6" />
              </span>
              <p className="font-medium">Nothing yet</p>
              <p className="max-w-sm text-sm text-muted">Requests, messages and changes to time show up here.</p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent>
              <ul>
                {all.map((e) => (
                  <EventRow key={e.id} event={e} timeZone={timeZone} now={now} />
                ))}
              </ul>
              {events.hasNextPage && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4 w-full"
                  disabled={events.isFetchingNextPage}
                  onClick={() => void events.fetchNextPage()}
                >
                  {events.isFetchingNextPage && <Loader2 className="animate-spin" />}
                  Show older
                </Button>
              )}
            </CardContent>
          </Card>
        )}
      </section>
    </>
  );
}
```

### 5.5 `web/src/router.tsx`

The same as before with two changes: `/inbox` uses `InboxPage`, and the signed-in layout puts `<SosBanner />` above every page.

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
import { SosBanner } from '@/components/sos-banner';
import { useAuth } from '@/lib/auth';
import { ComingSoon } from '@/pages/coming-soon';
import { InboxPage } from '@/pages/inbox';
import { KidPage } from '@/pages/kid';
import { KidsPage } from '@/pages/kids';
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

/** Every page but sign-in: signed-out visitors go to /sign-in; a super admin with no family only has /admin. An active SOS shows on top of every page. */
function SignedInLayout() {
  const auth = useAuth();
  const path = useRouterState({ select: (s) => s.location.pathname });
  if (auth.status === 'loading') return <FullScreenSpinner />;
  if (auth.status === 'signedOut') return <Navigate to="/sign-in" />;
  if (!auth.me.family && path !== '/admin') return <Navigate to="/admin" />;
  return (
    <AppShell me={auth.me}>
      <SosBanner />
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
const inboxRoute = createRoute({ getParentRoute: () => appRoute, path: '/inbox', component: InboxPage });
const kidsRoute = createRoute({ getParentRoute: () => appRoute, path: '/kids', component: KidsPage });
const kidRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/kids/$kidId',
  component: function KidRoute() {
    const { kidId } = kidRoute.useParams();
    // Keyed by kid, so unsaved edits never carry over to another kid's page.
    return <KidPage key={kidId} kidId={kidId} />;
  },
});
const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings',
  component: () => <ComingSoon title="Settings" description="Notifications, presets, parents and the parent code." />,
});
const adminRoute = createRoute({ getParentRoute: () => appRoute, path: '/admin', component: AdminOnly });

const routeTree = rootRoute.addChildren([
  signInRoute,
  appRoute.addChildren([todayRoute, inboxRoute, kidsRoute, kidRoute, settingsRoute, adminRoute]),
]);

export const router = createRouter({ routeTree, defaultPreload: 'intent' });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
```

### 5.6 `web/test/inbox.test.ts`

```typescript
import type { EventItem } from '@screentime/schemas';
import { describe, expect, it } from 'vitest';
import { eventView, mapUrl, pendingParentModeRequests, whenText } from '../src/lib/inbox';

const TZ = 'Australia/Sydney';
// 12:00 pm on Monday 26 October 2026 in Sydney (UTC+11).
const NOW = new Date('2026-10-26T01:00:00Z');

let n = 0;
function event(kind: string, payload: Record<string, unknown>, extra: Partial<EventItem> = {}): EventItem {
  n += 1;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    kind,
    at: '2026-10-26T00:55:00Z',
    kidId: '10000000-0000-4000-8000-000000000001',
    kidName: 'Alex',
    deviceId: '20000000-0000-4000-8000-000000000001',
    deviceName: 'Pixel 7',
    payload,
    ...extra,
  };
}

describe('eventView', () => {
  it('reads requests, answers and messages', () => {
    expect(eventView(event('time_request', { pool: 'phone', minutes: 30, reason: 'finishing homework video' }), TZ)).toEqual({
      text: 'Alex asked for 30m more Phone',
      detail: '“finishing homework video”',
      tone: 'request',
    });
    expect(eventView(event('time_request', { pool: 'screens', minutes: 60, reason: null }), TZ).detail).toBeNull();
    expect(eventView(event('time_request.resolved', { approved: true, minutes: 45, byName: 'Mum' }), TZ).text).toBe(
      'Mum said yes to Alex: 45m more',
    );
    expect(eventView(event('time_request.resolved', { approved: false, minutes: 0, byName: 'Dad' }), TZ).text).toBe(
      "Dad said no to Alex's request",
    );
    expect(eventView(event('kid_message', { body: 'Can I stay at Sam’s?' }), TZ)).toEqual({
      text: 'Message from Alex',
      detail: '“Can I stay at Sam’s?”',
      tone: 'message',
    });
  });

  it('reads grants, lock now and overspend', () => {
    expect(eventView(event('grant.added', { pool: 'screens', minutes: 90, byName: 'Dad', lockNow: false }), TZ).text).toBe(
      'Dad added 1h 30m of Screens for Alex',
    );
    expect(eventView(event('grant.added', { pool: 'phone', minutes: -15, byName: 'Mum', lockNow: false }), TZ).text).toBe(
      'Mum took away 15m of Phone from Alex',
    );
    expect(eventView(event('grant.added', { pool: 'phone', minutes: -45, byName: 'Mum', lockNow: true }), TZ).text).toBe(
      "Mum locked Alex's Phone",
    );
    const over = eventView(event('overspend', { pool: 'screens', overspendSec: 720, deviceName: 'XPPen Pad' }, { deviceName: null }), TZ);
    expect(over.text).toBe('Alex went 12m over on Screens');
    expect(over.detail).toBe('XPPen Pad was offline, so it could not know the time had run out');
    expect(over.tone).toBe('alert');
  });

  it('reads parent mode', () => {
    expect(eventView(event('parent_mode.request', { requestId: 'r' }), TZ).text).toBe('Alex asked for parent mode on Pixel 7');
    expect(eventView(event('parent_mode.used', { sessionId: 's', durationMin: 15, byName: 'Dad' }), TZ)).toEqual({
      text: 'Parent mode on Pixel 7 for 15 min',
      detail: 'Started by Dad',
      tone: 'info',
    });
    expect(eventView(event('parent_mode.used', { sessionId: 's', durationMin: 60, byName: null }), TZ)).toMatchObject({
      text: 'Parent mode on Pixel 7 for 1 hour',
      detail: 'Started with the parent code',
    });
    expect(eventView(event('parent_mode.used', { sessionId: 's', durationMin: null, byName: 'Mum' }), TZ).text).toBe(
      'Parent mode on Pixel 7 until ended',
    );
    expect(eventView(event('parent_mode.ended', { sessionId: 's', byName: null }), TZ)).toMatchObject({
      text: 'Parent mode ended on Pixel 7',
      detail: null,
    });
  });

  it('reads SOS events', () => {
    expect(eventView(event('sos.started', { sosId: 'x' }), TZ)).toEqual({ text: 'SOS from Alex', detail: 'On Pixel 7', tone: 'sos' });
    expect(eventView(event('sos.acked', { sosId: 'x', byName: 'Mum' }), TZ).text).toBe("Mum is on Alex's SOS");
    expect(eventView(event('sos.extended', { sosId: 'x', byName: 'Dad', autoStopAt: '2026-10-26T05:00:00Z' }), TZ).detail).toBe(
      'Until 4:00 pm',
    );
    expect(eventView(event('sos.ended', { sosId: 'x', endedBy: 'kid', byName: null }), TZ).text).toBe('Alex ended the SOS: safe');
    expect(eventView(event('sos.ended', { sosId: 'x', endedBy: 'parent', byName: 'Dad' }), TZ).text).toBe("Dad ended Alex's SOS");
    expect(eventView(event('sos.ended', { sosId: 'x', endedBy: 'auto', byName: null }), TZ).text).toBe("Alex's SOS stopped by itself");
  });

  it('reads devices, tamper and unknown kinds', () => {
    expect(eventView(event('device.enrolled', { name: 'XPPen Pad', form: 'tablet', platform: 'android' }), TZ).text).toBe(
      'XPPen Pad was added for Alex',
    );
    expect(eventView(event('device.offline', { lastSeenAt: '2026-10-25T23:30:00Z', deviceName: 'Pixel 7' }), TZ)).toEqual({
      text: 'Pixel 7 is offline',
      detail: 'Last seen at 10:30 am',
      tone: 'info',
    });
    expect(eventView(event('tamper.clock', { skewSec: 3600 }), TZ)).toEqual({
      text: 'Pixel 7: the clock was changed',
      detail: null,
      tone: 'alert',
    });
    expect(eventView(event('tamper.call_blocked', { number: '0400111222' }), TZ).detail).toBe('Number: 0400111222');
    expect(eventView(event('tamper.something_new', {}), TZ).text).toBe('Pixel 7: something was tampered with');
    expect(eventView(event('mystery.kind', {}, { kidName: null }), TZ)).toEqual({ text: 'mystery.kind', detail: null, tone: 'info' });
  });
});

describe('pendingParentModeRequests', () => {
  it('keeps requests from the last 10 minutes with no answer, newest first', () => {
    const waiting = event('parent_mode.request', { requestId: 'a' }, { at: '2026-10-26T00:58:00Z' });
    const answered = event('parent_mode.request', { requestId: 'b' }, { at: '2026-10-26T00:57:00Z' });
    const used = event('parent_mode.used', { sessionId: 'b', durationMin: 5, byName: 'Mum' }, { at: '2026-10-26T00:57:30Z' });
    const denied = event('parent_mode.request', { requestId: 'c' }, { at: '2026-10-26T00:56:00Z' });
    const no = event('parent_mode.denied', { sessionId: 'c', byName: 'Dad' }, { at: '2026-10-26T00:56:30Z' });
    const old = event('parent_mode.request', { requestId: 'd' }, { at: '2026-10-26T00:49:59Z' });
    const events = [waiting, used, answered, no, denied, old];
    expect(pendingParentModeRequests(events, NOW).map((e) => e.payload.requestId)).toEqual(['a']);
  });
});

describe('whenText', () => {
  it('shows the time today, "Yesterday", then the date, in the family time zone', () => {
    expect(whenText('2026-10-25T22:15:00Z', NOW, TZ)).toBe('9:15 am');
    // 11:30 pm on Sunday in Sydney, though it is still Sunday in UTC too.
    expect(whenText('2026-10-25T12:30:00Z', NOW, TZ)).toBe('Yesterday, 11:30 pm');
    // 10:59 am on Sunday in Sydney is Saturday 23:59 in UTC: Sydney's date counts.
    expect(whenText('2026-10-24T23:59:00Z', NOW, TZ)).toBe('Yesterday, 10:59 am');
    expect(whenText('2026-10-24T04:42:00Z', NOW, TZ)).toBe('Sat 24 Oct, 3:42 pm');
  });
});

describe('mapUrl', () => {
  it('links to Google Maps', () => {
    expect(mapUrl({ lat: -33.8688, lng: 151.2093 })).toBe('https://www.google.com/maps/search/?api=1&query=-33.8688,151.2093');
  });
});
```

## 6. Detailed spec

### 6.1 Waiting for you

- The section shows only when something waits. Parent-mode requests come first (the kid is standing there with a parent), then time requests, oldest last as the API sends them.
- **Time request card**: a hand icon, `<kid> wants <30m> more <Pool>`, the kid's reason in curly quotes if there is one, `<device> · <time>`, and on the right `Other amount` (a text button), `No` and `Yes, <30m>`. Yes gives exactly what was asked. An error (for example `This request has expired.`) shows in red on the card.
- **Other amount** dialog: `Give <kid> more <Pool>`, `<kid> asked for 30m. It counts for today only.`, `−` and `+` round buttons in 15-minute steps from 15m to 8h, quick amounts 15m, 30m, 1h 00m, 2h 00m, and `Give <amount>`.
- **Parent-mode card**: `<kid> asks for parent mode on <device>`, `Someone pressed “I'm the parent” on <device>. Say yes only if a parent is there with it.`, the time, the five lengths (`2 min`, `5 min`, `15 min` picked first, `1 hour`, `Until I end it`), `No` and `Start parent mode`.
- A request is still waiting when its `parent_mode.request` event is less than 10 minutes old and no `parent_mode.used`, `parent_mode.denied` or `parent_mode.ended` event has the same session id (`requestId` = `sessionId`). The server keeps the real state: answering one that just ran out shows its 409 message.
- After any answer the requests, the history and Today refresh.

### 6.2 History

- A card with one row per event: a round icon (red siren for SOS, amber shield for tamper and overspend, teal hand for requests, teal bubble for messages, grey clock for time changes, grey "i" for the rest), the sentence in medium weight, an optional second line in muted grey, and the time on the right: `3:42 pm` today, `Yesterday, 3:42 pm`, then `Sat 24 Oct, 3:42 pm`, always in the family time zone.
- Every sentence is in `eventView` (5.1) and its tests. An unknown kind shows the kind itself, so a newer server never breaks the page.
- The history refreshes every 30 seconds (SPEC §13). `Show older` loads the next 50.
- Nothing yet: `Nothing yet`, `Requests, messages and changes to time show up here.`

### 6.3 SOS banner

- Above the page content on every signed-in page, one banner per active SOS, checked every 15 seconds. A super admin without a family does not check.
- A pulsing siren, `SOS from <kid>`, then `Started 1:45 pm on Pixel 7 · Last position 1:46 pm · Battery 41%` (or `No position yet`), then `<names> on it` once a parent pressed I'm on it.
- Buttons: `Open map` (white, opens Google Maps at the last position in a new tab; only with a position), `I'm on it` (white; becomes `You're on it` with a check after you press it), `End SOS` (white text). End SOS asks `End <kid>'s SOS?` with `Only end it when you know <kid> is safe. Their phone stops sharing its position, and the other parents are told.`, `Cancel` and a red `End SOS`.

## 7. Steps

All commands in PowerShell from `C:\Users\james\OpenCode\Testing\ScreenTime` unless stated otherwise.

1. Start from the latest `main` and create the branch:
   ```powershell
   git checkout main
   git pull origin main
   git checkout -b bob/card-025-inbox
   pnpm install --frozen-lockfile
   ```
   After the pull, `docs/cards/CARD-025-inbox.md` and `web/src/components/devices-panel.tsx` (CARD-024) must exist. If one is missing, run `git pull origin main` again, and if it is still missing, stop and ask James.
2. Create 5.1 and 5.2, replace 5.3, create 5.4, and replace 5.5. Run `pnpm build` and `pnpm typecheck`. Commit: `CARD-025: add the Inbox and the SOS banner`.
3. Create 5.6. Run `pnpm --filter @screentime/web test`. Commit: `CARD-025: add Inbox tests`.
4. Run the acceptance checks in section 8.
5. Push and open the PR (section 10).
6. Wait for both CI checks to finish (`gh pr checks <number> --watch`).
7. Send James the handback report (section 12).

## 8. Acceptance criteria

Never put a real password, JWT secret, SMTP key, Firebase key, FCM token or device token in the PR or the handback.

- [ ] `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm typecheck` and `pnpm test` pass, and `git status --short pnpm-lock.yaml` is empty. `pnpm build` ends the web part with `✓ built in` (the 500 kB chunk warning is expected). Without `TEST_DATABASE_URL`:
  - `packages/schemas`: `Tests  36 passed (36)`.
  - `packages/engine`: `Tests  27 passed (27)`.
  - `web`: `test/format.test.ts (3 tests)`, `test/api.test.ts (6 tests)`, `test/today.test.ts (9 tests)`, `test/kid.test.ts (10 tests)`, `test/inbox.test.ts (8 tests)`, `Tests  36 passed (36)`.
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
  (curl.exe -s http://localhost:5173/ | Out-String) -match '<div id="root"></div>'
  (curl.exe -s http://localhost:5173/src/pages/inbox.tsx | Out-String).Length -gt 1000
  ```
  Both print `True`. Stop `pnpm dev:web` with Ctrl+C. Claude checks the pages in a browser with test data after the PR is open; you do not need to sign in.
- [ ] `git status` does **not** list `deploy/.env` or anything in `web/dist/`.
- [ ] Both GitHub Actions checks are green on the PR: **TypeScript / typecheck and test** and **TypeScript / docker compose smoke test**. Wait for them (`gh pr checks <number> --watch`) before you write the handback.
- [ ] Only the expected files changed. `git diff --name-only main...HEAD` lists exactly these 6 files (in any order):
  ```
  web/src/components/devices-panel.tsx
  web/src/components/sos-banner.tsx
  web/src/lib/inbox.ts
  web/src/pages/inbox.tsx
  web/src/router.tsx
  web/test/inbox.test.ts
  ```

## 9. Tests

| File | What it asserts |
|---|---|
| `web/test/inbox.test.ts` | `eventView` for time requests (with and without a reason), yes and no answers, messages, added and taken-away time, lock now, overspend, the four parent-mode kinds (15 min, 1 hour, until ended, the parent code), the four SOS kinds (ended by the kid, a parent and by itself), a device added and offline, tamper with a known, a blocked-call and an unknown kind, and an unknown kind with no kid. `pendingParentModeRequests`: of five requests, only the unanswered one under 10 minutes old is left. `whenText`: today, yesterday (also when UTC is still on the day before), and an older date. `mapUrl`. |

## 10. Git and pull request

1. Start from the latest `main` (step 1 above).
2. Commit in small logical commits (steps 2 and 3). Message format: `CARD-025: <what changed>`.
3. Before pushing, run every acceptance command again and make sure all pass.
4. Push: `git push -u origin bob/card-025-inbox`
5. Open a PR into `main` titled `CARD-025: Inbox and SOS banner`. Write the body to `$env:TEMP\pr-body.md` (outside the repo) and run `gh pr create --base main --head bob/card-025-inbox --title "CARD-025: Inbox and SOS banner" --body-file $env:TEMP\pr-body.md`. Body:
   ```markdown
   ## Card
   docs/cards/CARD-025-inbox.md

   ## What I did
   - ...

   ## Acceptance criteria
   - [x] install, build, typecheck, test — output: `...`
   - [x] contract unchanged
   - [x] database tests — output: `Tests  212 passed (212)`
   - [x] dev server serves the app — output: `True`, `True`
   - [x] deploy/.env and web/dist not tracked
   - [x] both CI checks green
   - [x] only expected files changed — output: 6 files

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

- **A `whenText` test fails on your PC only**: the tests set the time zone themselves (`Australia/Sydney`), so your PC's own time zone does not matter. If one fails, report the exact output; do not change the test.
- **Special characters**: copy `“`, `”`, `’` and `·` exactly. Check with `Select-String -Path web\src\lib\inbox.ts -Pattern '“'`.
- **`curl` in PowerShell**: write `curl.exe`, not `curl`, and keep the `| Out-String` of section 8.
- **The live.test.ts `afterAll` hook timed out** in the database tests: in CARD-024 this happened once on your PC and not on the re-run. If it happens, run the database tests once more and report both outputs under "Commands run". Do not change the test.
- **Every difference from the card is a deviation**, in any file, including tests, comments, test data and how you ran a check. List each one under "Deviations".
- **A test fails**: do not change the test to make it pass, and do not skip it. Report it.

## 12. Handback report (required)

When the PR is open, your **last message to James** must be the handback report below, inside one fenced code block so James can copy it in one go and paste it to Claude. Claude checks every line of it against the PR, the CI logs and its own test run, so write only what you actually saw.

Rules:

- Every command line shows the **real** output you saw, copied, not retyped from the card. If you did not run a command, write `NOT RUN` and the reason. Never write the expected output from the card as if you saw it.
- "Deviations" lists every way your files differ from the card, including comments, wording and whitespace. If you think the card is wrong, quote the exact card line and say what is wrong with it.
- "Outside the repo" lists anything you changed on James's PC outside the repo folder (config files, global tools, environment variables). Write `None` if there was nothing.

The report, filled in:

````text
Claude, here is Bob's handback for CARD-025. Please review and merge if it is good.

CARD: CARD-025 Inbox and SOS banner
PR: <full PR URL>
Branch: bob/card-025-inbox
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
