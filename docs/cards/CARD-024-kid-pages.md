# CARD-024: Kids pages: schedule, devices, contacts, add device

| Field | Value |
|---|---|
| Card | CARD-024 |
| Title | Kids pages: schedule, devices, contacts, add device |
| Size | M |
| Depends on | CARD-023 (merged to `main`) |
| Spec sections | docs/SPEC.md §6.1, §11.3, §16.1, §16.4, §16.5 |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-024-kid-pages` |
| PR title | `CARD-024: Kids pages: schedule, devices, contacts, add device` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first.

The parent web app is in `web/` (package `@screentime/web`): React 19, Vite, TanStack Router and Query, Tailwind CSS v4 with the design tokens of SPEC §16.1, shadcn/ui-style components in `web/src/components/ui`, and the API client `api` in `web/src/lib/auth.tsx`, which throws `ApiError` with the server's message. CARD-022 built sign-in and the layout; CARD-023 built the **Today** page and the adjust dialog. Imports inside `web/src` use the `@/` alias and have no file extension.

This card replaces the **Kids** placeholder with real pages, all on APIs that already exist:

- `/kids`: one row per kid (avatar, name, device names) that opens the kid's page, and **Add kid** (`POST /v1/kids`).
- `/kids/<kid id>`: the kid's avatar, name and **Edit** (`PATCH /v1/kids/{kidId}`), then four tabs (SPEC §16.5):
  - **Today**: the kid's two pool rows and chips from the Today page, with the same adjust dialog.
  - **Schedule**: 7 days of Screens and Phone allowance, wake-up and bedtime, two copy buttons, the two warnings, and **Save schedule** (`GET` and `PUT /v1/kids/{kidId}/schedule`).
  - **Devices**: the kid's devices (`GET /v1/devices`) with last seen, parent mode (`POST` and `DELETE /v1/devices/{id}/parent-mode`), rename (`PATCH /v1/devices/{id}`) and remove (`DELETE /v1/devices/{id}`), and **Add device**: pick Phone, Tablet or PC, get a code (`POST /v1/kids/{kidId}/enrolment-codes`), see a QR code and the 6 digits with a 10-minute countdown, and see the device appear when it enrols.
  - **Contacts**: the numbers the kid's phone can always call (`GET` and `PUT /v1/kids/{kidId}/contacts`).

The QR code is drawn by the `qrcode.react` package. Claude already added it to `web/package.json` and `pnpm-lock.yaml` on `main`, so `pnpm install --frozen-lockfile` installs it; you do not add or change any package.

## 2. Goal

A signed-in parent can add a kid, change a kid's name and colour, edit the weekly schedule and the warnings, keep the always-callable numbers, add a device with a QR code or 6-digit code, and rename, remove or start parent mode on a device, all in the web app at http://localhost:5173. The pure logic is covered by Vitest tests.

## 3. Out of scope

Do **not** do any of these in this card:

- No server change, no change to `packages/schemas`, and the contract stays the same.
- No new npm packages and no lockfile change. `pnpm-lock.yaml`, `pnpm-workspace.yaml` and every `package.json` stay as they are on `main`.
- No archiving (deleting) kids, no moving a device to the other pool, no grant history, no Inbox, Settings or Admin pages (CARD-025 and CARD-026).
- Do not run the shadcn CLI. Do not change any file that is not listed in section 5.
- Never commit `deploy/.env`, `web/dist/`, a real JWT secret, an SMTP key, a Firebase key, an FCM token or a device token.

## 4. Tech and versions

Unchanged from `main`: Node 24, pnpm 11, TypeScript ^5.9, Vitest ^3.2, React ^19.3.1, Vite ^7.3.7, @tanstack/react-query ^5.104.5, @tanstack/react-router ^1.170.46, Tailwind CSS ^4.3.3, radix-ui ^1.8.1 (its `Tabs`, `DropdownMenu` and `Dialog`), lucide-react ^1.61.0, and qrcode.react ^4.2.0 (already on `main`, its `QRCodeSVG` component).

`pnpm build` now prints a Vite warning `(!) Some chunks are larger than 500 kB after minification` for the web app. That is expected in this card (one bundle for the whole app, about 550 kB, 178 kB gzipped); it is a warning, not an error, and the build still ends with `✓ built in`.

Docker Desktop must be running for the server's database tests (check: `docker version` prints a `Server:` section).

## 5. Files

Create or change exactly these files. Paths are relative to the repo root. Copy every code block exactly, character for character, blank lines included. This card is UTF-8; if you see `Â` or `â€` anywhere, you are reading it with the wrong encoding: open it as UTF-8, and do not report it as a card error. Some strings use characters that look like plain ones but are not: `·` (U+00B7) in the device and parent-mode texts, `…` (U+2026, one character) in menu items and "Waiting for the device…", and the no-break space `\u00a0` written as those six characters in `pages/kids.tsx`. Copy them exactly.

| File | Action |
|---|---|
| `web/src/lib/api.ts` | replace (5.1) |
| `web/src/lib/schedule.ts` | create (5.2) |
| `web/src/lib/kid.ts` | create (5.3) |
| `web/src/components/ui/select.tsx` | create (5.4) |
| `web/src/components/ui/tabs.tsx` | create (5.5) |
| `web/src/components/ui/dropdown-menu.tsx` | create (5.6) |
| `web/src/components/kid-dialog.tsx` | create (5.7) |
| `web/src/components/schedule-editor.tsx` | create (5.8) |
| `web/src/components/contacts-editor.tsx` | create (5.9) |
| `web/src/components/add-device-dialog.tsx` | create (5.10) |
| `web/src/components/devices-panel.tsx` | create (5.11) |
| `web/src/pages/today.tsx` | replace (5.12) |
| `web/src/pages/kids.tsx` | create (5.13) |
| `web/src/pages/kid.tsx` | create (5.14) |
| `web/src/router.tsx` | replace (5.15) |
| `web/test/kid.test.ts` | create (5.16) |

That is 16 files.

### 5.1 `web/src/lib/api.ts`

The same as before plus a `patch` method (after `post`).

```typescript
import type { AuthResponse } from '@screentime/schemas';

/** An error answer from the API (`{ "error": { "code", "message" } }`), or a network failure (status 0). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Fetch = (input: string, init: RequestInit) => Promise<Response>;
type AuthListener = (auth: AuthResponse | null) => void;

const JSON_HEADERS = { 'content-type': 'application/json' };

async function errorOf(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as { error?: { code?: unknown; message?: unknown } };
    const { code, message } = body.error ?? {};
    if (typeof code === 'string' && typeof message === 'string') return new ApiError(res.status, code, message);
  } catch {
    // Not JSON: fall through.
  }
  return new ApiError(res.status, 'http_error', `Something went wrong (${res.status}). Try again.`);
}

/**
 * The parent web app's client for /v1 on its own origin (docs/SPEC.md §11.1). The access token lives in
 * memory only. The refresh token is the HttpOnly `st_refresh` cookie: the browser sends it to /v1/auth by
 * itself and page scripts never see it. A 401 refreshes once and retries; concurrent callers share one refresh.
 */
export class Api {
  private accessToken: string | null = null;
  private refreshing: Promise<AuthResponse | null> | null = null;
  private readonly listeners = new Set<AuthListener>();
  private readonly fetchFn: Fetch;

  constructor(fetchFn?: Fetch) {
    this.fetchFn = fetchFn ?? ((input, init) => fetch(input, init));
  }

  /** Called with the new sign-in after every sign-in and refresh, and with null when signed out. */
  onAuthChange(listener: AuthListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setAuth(auth: AuthResponse | null) {
    this.accessToken = auth?.accessToken ?? null;
    for (const listener of this.listeners) listener(auth);
  }

  private async send(path: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchFn(path, init);
    } catch {
      throw new ApiError(0, 'network', "Can't reach ScreenTime. Check your connection and try again.");
    }
  }

  /** Emails a sign-in code. Answers the same whether or not the email can sign in. */
  async requestCode(email: string): Promise<void> {
    const res = await this.send('/v1/auth/otp/request', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ email }),
    });
    if (!res.ok) throw await errorOf(res);
  }

  async verifyCode(email: string, code: string): Promise<AuthResponse> {
    const res = await this.send('/v1/auth/otp/verify', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ email, code, client: 'web', clientLabel: 'Web browser' }),
    });
    if (!res.ok) throw await errorOf(res);
    const auth = (await res.json()) as AuthResponse;
    this.setAuth(auth);
    return auth;
  }

  /** Uses the cookie to get a new access token. Null (and signed out) when the session is gone. */
  refresh(): Promise<AuthResponse | null> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh(): Promise<AuthResponse | null> {
    const res = await this.send('/v1/auth/refresh', { method: 'POST', headers: JSON_HEADERS, body: '{}' });
    if (res.status === 401) {
      this.setAuth(null);
      return null;
    }
    if (!res.ok) throw await errorOf(res);
    const auth = (await res.json()) as AuthResponse;
    this.setAuth(auth);
    return auth;
  }

  /** Ends the session on the server (which also clears the cookie). Signed out here even if that fails. */
  async signOut(): Promise<void> {
    try {
      if (this.accessToken) {
        await this.send('/v1/auth/logout', { method: 'POST', headers: { authorization: `Bearer ${this.accessToken}` } });
      }
    } catch {
      // Signed out locally anyway.
    }
    this.setAuth(null);
  }

  /** A signed-in call. Resolves to the parsed JSON body, or undefined for 204. */
  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.accessToken && !(await this.refresh())) throw new ApiError(401, 'unauthorized', 'Sign in again.');
    let res = await this.call(method, path, body);
    if (res.status === 401) {
      if (!(await this.refresh())) throw new ApiError(401, 'unauthorized', 'Sign in again.');
      res = await this.call(method, path, body);
    }
    if (!res.ok) throw await errorOf(res);
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  private call(method: string, path: string, body: unknown): Promise<Response> {
    const headers: Record<string, string> = { authorization: `Bearer ${this.accessToken ?? ''}` };
    if (body !== undefined) headers['content-type'] = 'application/json';
    return this.send(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body);
  }

  put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', path, body);
  }

  delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }
}
```

### 5.2 `web/src/lib/schedule.ts`

The schedule editor's logic, with no React in it: the options of each select, 12-hour times, the copy buttons and the checks.

```typescript
import type { ScheduleDay, ScheduleInput } from '@screentime/schemas';
import { formatDuration } from '@/lib/format';

/** ISO weekday 1 (Monday) to 7 (Sunday), as the schedule stores them. */
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export const SCHEDULE_STEP = 15;
/** The longest allowance the editor offers. The API allows up to 24 hours, so a longer saved value is kept as an option. */
export const MAX_ALLOWANCE_MIN = 12 * 60;
export const WARN1_OPTIONS = [10, 15, 20, 30, 45, 60];
export const WARN2_OPTIONS = [1, 2, 3, 5, 10];

export interface Option<T> {
  value: T;
  label: string;
}

function minutesOf(time: string): number {
  const [h = 0, m = 0] = time.split(':').map(Number);
  return h * 60 + m;
}

function timeOf(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** "7:00 am", "12:30 pm", "midnight" for the end of the day (docs/SPEC.md §16.1, 12-hour). */
export function formatClock(time: string): string {
  const minutes = minutesOf(time);
  if (minutes === 1440) return 'midnight';
  const h = Math.floor(minutes / 60);
  const m = String(minutes % 60).padStart(2, '0');
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? 'am' : 'pm'}`;
}

/** Adds the saved value when it is off the 15-minute grid, so the select still shows it. */
function withCurrent<T extends string | number>(options: Option<T>[], current: T, label: (v: T) => string, key: (v: T) => number) {
  if (options.some((o) => o.value === current)) return options;
  return [...options, { value: current, label: label(current) }].sort((a, b) => key(a.value) - key(b.value));
}

/** Wake-up: midnight to 11:45 pm. Bedtime: 12:15 am to midnight (end of day). 15-minute steps. */
export function timeOptions(kind: 'wake' | 'bedtime', current: string): Option<string>[] {
  const first = kind === 'wake' ? 0 : SCHEDULE_STEP;
  const last = kind === 'wake' ? 1440 - SCHEDULE_STEP : 1440;
  const options: Option<string>[] = [];
  for (let m = first; m <= last; m += SCHEDULE_STEP) options.push({ value: timeOf(m), label: formatClock(timeOf(m)) });
  return withCurrent(options, current, formatClock, minutesOf);
}

export function formatAllowance(minutes: number): string {
  return minutes === 0 ? 'No time' : formatDuration(minutes * 60);
}

/** No time, 15m, 30m … 12h 00m. */
export function allowanceOptions(current: number): Option<number>[] {
  const options: Option<number>[] = [];
  for (let m = 0; m <= MAX_ALLOWANCE_MIN; m += SCHEDULE_STEP) options.push({ value: m, label: formatAllowance(m) });
  return withCurrent(options, current, formatAllowance, (v) => v);
}

/** Tuesday to Friday become copies of Monday. */
export function copyMondayToWeekdays(days: ScheduleDay[]): ScheduleDay[] {
  const monday = days.find((d) => d.weekday === 1);
  if (!monday) return days;
  return days.map((day) => (day.weekday >= 2 && day.weekday <= 5 ? { ...monday, weekday: day.weekday } : day));
}

/** Sunday becomes a copy of Saturday. */
export function copySaturdayToWeekend(days: ScheduleDay[]): ScheduleDay[] {
  const saturday = days.find((d) => d.weekday === 6);
  if (!saturday) return days;
  return days.map((day) => (day.weekday === 7 ? { ...saturday, weekday: 7 } : day));
}

export interface ScheduleErrors {
  /** Bedtime message per weekday (1 to 7) with a wake-up at or after bedtime. */
  days: Record<number, string>;
  warnings: string | null;
}

/** The same rules as the API (packages/schemas kids.ts), with words for the form. */
export function scheduleErrors(schedule: ScheduleInput): ScheduleErrors {
  const days: Record<number, string> = {};
  for (const day of schedule.days) {
    if (day.wake >= day.bedtime) days[day.weekday] = 'Bedtime must be after wake-up.';
  }
  const warnings = schedule.warn1Min > schedule.warn2Min ? null : 'The first warning must come before the second.';
  return { days, warnings };
}

export function hasErrors(errors: ScheduleErrors): boolean {
  return Object.keys(errors.days).length > 0 || errors.warnings !== null;
}
```

### 5.3 `web/src/lib/kid.ts`

Small helpers for devices and contacts: last seen, the code countdown, and turning a typed phone number into international format.

```typescript
import type { DeviceForm } from '@screentime/schemas';

export const FORM_NAMES: Record<DeviceForm, string> = { phone: 'Phone', tablet: 'Tablet', pc: 'PC' };

/** "Seen just now", "Seen 12 min ago", "Seen 3h ago", "Seen 2 days ago", "Never connected". */
export function lastSeenText(lastSeenAt: string | null, now: Date): string {
  if (!lastSeenAt) return 'Never connected';
  const minutes = Math.floor((now.getTime() - new Date(lastSeenAt).getTime()) / 60_000);
  if (minutes < 1) return 'Seen just now';
  if (minutes < 60) return `Seen ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Seen ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `Seen ${days} ${days === 1 ? 'day' : 'days'} ago`;
}

/** "9:41" until the code expires, "0:00" after. */
export function countdownText(expiresAt: string, now: Date): string {
  const seconds = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now.getTime()) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** "123 456": easier to read out and type. */
export function spacedCode(code: string): string {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

const E164 = /^\+[1-9][0-9]{6,14}$/;

/**
 * A typed phone number in international format, or null when it is not one. Spaces, dashes, dots and
 * brackets are dropped, and an Australian number starting with 0 gets +61 (the family locale is en-AU).
 */
export function normalisePhone(text: string): string | null {
  const compact = text.replace(/[\s\-.()]/g, '');
  const phone = /^0[1-9][0-9]{8}$/.test(compact) ? `+61${compact.slice(1)}` : compact;
  return E164.test(phone) ? phone : null;
}
```

### 5.4 `web/src/components/ui/select.tsx`

A native `<select>` styled like `Input` (44 px high, 12 px radius, a chevron on the right).

```tsx
import { ChevronDown } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** A native select styled like Input: the browser's own list works with touch, keyboard and screen readers. */
export function Select({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <div className={cn('relative', className)}>
      <select
        data-slot="select"
        className="h-11 w-full min-w-0 cursor-pointer appearance-none rounded-xl border border-outline bg-surface pr-9 pl-3 text-sm tabular-nums outline-none transition-colors focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger"
        {...props}
      >
        {children}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted" />
    </div>
  );
}
```

### 5.5 `web/src/components/ui/tabs.tsx`

Radix `Tabs` as a pill switch. Every tab's content stays mounted (only hidden), so unsaved edits survive switching tabs.

```tsx
import { Tabs as TabsPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** shadcn/ui tabs as a pill switch, like the pool switch of the adjust dialog. */
export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn('flex w-full gap-1 overflow-x-auto rounded-full bg-surface-variant p-1 sm:w-fit', className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        'h-10 flex-1 rounded-full px-2 text-sm font-medium whitespace-nowrap text-muted transition-colors outline-none hover:text-on-surface focus-visible:ring-2 focus-visible:ring-primary data-[state=active]:bg-surface data-[state=active]:text-on-surface data-[state=active]:shadow-sm sm:flex-none sm:px-4',
        className,
      )}
      {...props}
    />
  );
}

/** Kept mounted while hidden, so unsaved edits survive a switch to another tab. */
export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      forceMount
      className={cn('mt-6 outline-none data-[state=inactive]:hidden', className)}
      {...props}
    />
  );
}
```

### 5.6 `web/src/components/ui/dropdown-menu.tsx`

Radix `DropdownMenu` for the device "more" menu.

```tsx
import { DropdownMenu as MenuPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** shadcn/ui dropdown menu: a small surface under its button, 16 px radius. */
export const DropdownMenu = MenuPrimitive.Root;
export const DropdownMenuTrigger = MenuPrimitive.Trigger;

export function DropdownMenuContent({ className, sideOffset = 6, ...props }: ComponentProps<typeof MenuPrimitive.Content>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        data-slot="dropdown-menu-content"
        align="end"
        sideOffset={sideOffset}
        className={cn('z-50 min-w-48 rounded-2xl border border-outline bg-surface p-1.5 shadow-lg', className)}
        {...props}
      />
    </MenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  danger = false,
  ...props
}: ComponentProps<typeof MenuPrimitive.Item> & { danger?: boolean }) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      className={cn(
        'flex h-10 cursor-pointer items-center gap-3 rounded-xl px-3 text-sm outline-none select-none data-[highlighted]:bg-surface-variant data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
        danger ? 'text-danger' : 'text-on-surface [&_svg]:text-muted',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({ className, ...props }: ComponentProps<typeof MenuPrimitive.Separator>) {
  return <MenuPrimitive.Separator className={cn('my-1 h-px bg-outline', className)} {...props} />;
}
```

### 5.7 `web/src/components/kid-dialog.tsx`

Add a kid, or change a kid's name and colour.

```tsx
import type { AvatarColor, Kid } from '@screentime/schemas';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { KidAvatar } from '@/components/kid-avatar';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';
import { api } from '@/lib/auth';
import { cn } from '@/lib/utils';

/** The 8 avatar colours of docs/SPEC.md §16.1, with names for screen readers. */
const COLOR_NAMES: Record<AvatarColor, string> = {
  '#0F766E': 'Teal',
  '#7C3AED': 'Violet',
  '#DB2777': 'Pink',
  '#2563EB': 'Blue',
  '#EA580C': 'Orange',
  '#16A34A': 'Green',
  '#CA8A04': 'Gold',
  '#475569': 'Slate',
};
const COLORS = Object.keys(COLOR_NAMES) as AvatarColor[];

/** The dialog's body: mounted fresh each time it opens, so it starts from the kid (or blank). */
function KidForm({ kid, onDone }: { kid: Kid | null; onDone: (kid: Kid) => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(kid?.name ?? '');
  const [color, setColor] = useState<AvatarColor>(kid?.avatarColor ?? '#0F766E');
  const save = useMutation({
    mutationFn: () =>
      kid
        ? api.patch<Kid>(`/v1/kids/${kid.id}`, { name: name.trim(), avatarColor: color })
        : api.post<Kid>('/v1/kids', { name: name.trim(), avatarColor: color }),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ['kids'] });
      void queryClient.invalidateQueries({ queryKey: ['today'] });
      onDone(saved);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) save.mutate();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <DialogTitle>{kid ? `Edit ${kid.name}` : 'Add a kid'}</DialogTitle>
      <div className="flex items-center gap-4">
        <KidAvatar name={name || '?'} color={color} className="size-14 text-xl" />
        <div className="flex flex-1 flex-col gap-2">
          <Label htmlFor="kid-name">Name</Label>
          <Input id="kid-name" value={name} maxLength={40} autoComplete="off" onChange={(e) => setName(e.target.value)} />
        </div>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Colour</legend>
        <div role="radiogroup" aria-label="Colour" className="grid grid-cols-8 gap-2">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={COLOR_NAMES[c]}
              onClick={() => setColor(c)}
              className={cn(
                'flex aspect-square items-center justify-center rounded-full text-white outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
                color === c && 'ring-2 ring-on-surface ring-offset-2 ring-offset-surface',
              )}
              style={{ backgroundColor: c }}
            >
              {color === c && <Check className="size-4" />}
            </button>
          ))}
        </div>
      </fieldset>
      {save.error && (
        <p role="alert" className="text-sm text-danger">
          {save.error instanceof ApiError ? save.error.message : 'Something went wrong. Try again.'}
        </p>
      )}
      <Button type="submit" disabled={save.isPending || !name.trim()}>
        {save.isPending && <Loader2 className="animate-spin" />}
        {kid ? 'Save' : 'Add kid'}
      </Button>
    </form>
  );
}

/** Add a kid (kid null) or change a kid's name and colour. A new kid starts with the default schedule. */
export function KidDialog({
  open,
  kid,
  onClose,
  onSaved,
}: {
  open: boolean;
  kid: Kid | null;
  onClose: () => void;
  onSaved?: (kid: Kid) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        {open && (
          <KidForm
            kid={kid}
            onDone={(saved) => {
              onClose();
              onSaved?.(saved);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
```

### 5.8 `web/src/components/schedule-editor.tsx`

```tsx
import type { Schedule, ScheduleDay, ScheduleInput } from '@screentime/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Loader2, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { ApiError } from '@/lib/api';
import { api } from '@/lib/auth';
import {
  allowanceOptions,
  copyMondayToWeekdays,
  copySaturdayToWeekend,
  hasErrors,
  type Option,
  scheduleErrors,
  timeOptions,
  WARN1_OPTIONS,
  WARN2_OPTIONS,
  WEEKDAYS,
} from '@/lib/schedule';
import { cn } from '@/lib/utils';

function messageOf(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong. Try again.';
}

function inputOf(schedule: Schedule): ScheduleInput {
  return { warn1Min: schedule.warn1Min, warn2Min: schedule.warn2Min, days: schedule.days };
}

const GRID = 'grid grid-cols-2 gap-3 md:grid-cols-[7.5rem_repeat(4,minmax(0,1fr))] md:items-center';

function Field<T extends string | number>({
  label,
  value,
  options,
  invalid,
  onChange,
}: {
  label: string;
  value: T;
  options: Option<T>[];
  invalid?: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-xs text-muted md:sr-only">{label}</span>
      <Select
        value={String(value)}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange((typeof value === 'number' ? Number(e.target.value) : e.target.value) as T)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </label>
  );
}

function DayRow({ day, error, onChange }: { day: ScheduleDay; error?: string; onChange: (day: ScheduleDay) => void }) {
  const name = WEEKDAYS[day.weekday - 1];
  return (
    <div role="group" aria-label={name} className="border-t border-outline py-3 first:border-t-0">
      <div className={GRID}>
        <p className="col-span-2 text-sm font-semibold md:col-span-1">{name}</p>
        <Field
          label="Screens"
          value={day.screensMin}
          options={allowanceOptions(day.screensMin)}
          onChange={(screensMin) => onChange({ ...day, screensMin })}
        />
        <Field
          label="Phone"
          value={day.phoneMin}
          options={allowanceOptions(day.phoneMin)}
          onChange={(phoneMin) => onChange({ ...day, phoneMin })}
        />
        <Field label="Wake-up" value={day.wake} options={timeOptions('wake', day.wake)} onChange={(wake) => onChange({ ...day, wake })} />
        <Field
          label="Bedtime"
          value={day.bedtime}
          options={timeOptions('bedtime', day.bedtime)}
          invalid={error !== undefined}
          onChange={(bedtime) => onChange({ ...day, bedtime })}
        />
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger md:text-right">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * docs/SPEC.md §16.4 Schedule: 7 rows (Screens and Phone allowance, wake-up, bedtime), the two copy
 * buttons and the two warnings. Saving writes a new schedule version; devices pick it up on their next sync.
 */
export function ScheduleEditor({ kidId, kidName }: { kidId: string; kidName: string }) {
  const queryClient = useQueryClient();
  const schedule = useQuery({
    queryKey: ['schedule', kidId],
    queryFn: () => api.get<Schedule>(`/v1/kids/${kidId}/schedule`),
  });
  // Unsaved edits; null when the form shows the saved schedule.
  const [draft, setDraft] = useState<ScheduleInput | null>(null);
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: (input: ScheduleInput) => api.put<Schedule>(`/v1/kids/${kidId}/schedule`, input),
    onSuccess: (result) => {
      queryClient.setQueryData(['schedule', kidId], result);
      void queryClient.invalidateQueries({ queryKey: ['today'] });
      setDraft(null);
      setSaved(true);
    },
  });

  if (!schedule.data) {
    return schedule.isError ? (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <p className="text-sm text-danger" role="alert">
            {messageOf(schedule.error)}
          </p>
          <Button variant="outline" onClick={() => void schedule.refetch()}>
            <RefreshCw />
            Try again
          </Button>
        </CardContent>
      </Card>
    ) : (
      <Card className="h-96 animate-pulse bg-surface-variant/50" aria-label="Loading" />
    );
  }

  const value = draft ?? inputOf(schedule.data);
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(inputOf(schedule.data));
  const errors = scheduleErrors(value);
  const edit = (next: ScheduleInput) => {
    setDraft(next);
    setSaved(false);
    save.reset();
  };
  const setDay = (day: ScheduleDay) => edit({ ...value, days: value.days.map((d) => (d.weekday === day.weekday ? day : d)) });

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Week</CardTitle>
          <CardDescription>
            Time {kidName} can use each day, and when the devices lock for the night. Bedtime always locks.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className={cn(GRID, 'hidden pb-2 text-xs font-medium text-muted md:grid')} aria-hidden>
            <span />
            <span>Screens</span>
            <span>Phone</span>
            <span>Wake-up</span>
            <span>Bedtime</span>
          </div>
          {value.days.map((day) => (
            <DayRow key={day.weekday} day={day} error={errors.days[day.weekday]} onChange={setDay} />
          ))}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => edit({ ...value, days: copyMondayToWeekdays(value.days) })}>
              <Copy />
              Copy Monday to weekdays
            </Button>
            <Button variant="outline" size="sm" onClick={() => edit({ ...value, days: copySaturdayToWeekend(value.days) })}>
              <Copy />
              Copy Saturday to weekend
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Warnings</CardTitle>
          <CardDescription>How long before time runs out {kidName} gets a warning.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:max-w-md sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">First warning</span>
            <Select
              value={String(value.warn1Min)}
              aria-invalid={errors.warnings !== null || undefined}
              onChange={(e) => edit({ ...value, warn1Min: Number(e.target.value) })}
            >
              {[...new Set([...WARN1_OPTIONS, value.warn1Min])]
                .sort((a, b) => a - b)
                .map((m) => (
                  <option key={m} value={m}>
                    {m} min before
                  </option>
                ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Second warning</span>
            <Select
              value={String(value.warn2Min)}
              aria-invalid={errors.warnings !== null || undefined}
              onChange={(e) => edit({ ...value, warn2Min: Number(e.target.value) })}
            >
              {[...new Set([...WARN2_OPTIONS, value.warn2Min])]
                .sort((a, b) => a - b)
                .map((m) => (
                  <option key={m} value={m}>
                    {m} min before
                  </option>
                ))}
            </Select>
          </label>
          {errors.warnings && (
            <p role="alert" className="text-sm text-danger sm:col-span-2">
              {errors.warnings}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-end gap-3">
        <p aria-live="polite" className="mr-auto text-sm">
          {save.error ? (
            <span className="text-danger">{messageOf(save.error)}</span>
          ) : saved ? (
            <span className="flex items-center gap-1.5 text-primary">
              <Check className="size-4" />
              Saved. {kidName}'s devices pick it up on their next sync.
            </span>
          ) : dirty ? (
            <span className="text-muted">Unsaved changes</span>
          ) : null}
        </p>
        {dirty && (
          <Button variant="ghost" disabled={save.isPending} onClick={() => {
              setDraft(null);
              save.reset();
            }}
          >
            Undo changes
          </Button>
        )}
        <Button disabled={!dirty || hasErrors(errors) || save.isPending} onClick={() => save.mutate(value)}>
          {save.isPending && <Loader2 className="animate-spin" />}
          Save schedule
        </Button>
      </div>
    </div>
  );
}
```

### 5.9 `web/src/components/contacts-editor.tsx`

```tsx
import type { KidContact } from '@screentime/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Phone, Plus, RefreshCw, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { api } from '@/lib/auth';
import { normalisePhone } from '@/lib/kid';

/** The API's limit (packages/schemas kids.ts KidContactsPut). */
const MAX_CONTACTS = 10;

interface Row {
  key: string;
  label: string;
  phone: string;
}

function messageOf(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong. Try again.';
}

function rowsOf(contacts: KidContact[]): Row[] {
  return contacts.map((c) => ({ key: c.id, label: c.label, phone: c.phoneE164 }));
}

function bodyOf(rows: Row[]) {
  return rows.map((r) => ({ label: r.label.trim(), phoneE164: normalisePhone(r.phone) ?? r.phone.trim() }));
}

function rowErrors(row: Row): { label?: string; phone?: string } {
  return {
    label: row.label.trim() ? undefined : 'Type a name.',
    phone: normalisePhone(row.phone) ? undefined : 'Type a number like 0412 345 678 or +61412345678.',
  };
}

/**
 * docs/SPEC.md §16.4 Always callable: numbers the kid's phone can call even when it is locked (Q33).
 * The whole list is saved at once, in this order.
 */
export function ContactsEditor({ kidId, kidName }: { kidId: string; kidName: string }) {
  const queryClient = useQueryClient();
  const contacts = useQuery({
    queryKey: ['contacts', kidId],
    queryFn: () => api.get<KidContact[]>(`/v1/kids/${kidId}/contacts`),
  });
  const [draft, setDraft] = useState<Row[] | null>(null);
  // Errors show after the first Save, not while typing.
  const [tried, setTried] = useState(false);
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: (rows: Row[]) => api.put<KidContact[]>(`/v1/kids/${kidId}/contacts`, { contacts: bodyOf(rows) }),
    onSuccess: (result) => {
      queryClient.setQueryData(['contacts', kidId], result);
      setDraft(null);
      setTried(false);
      setSaved(true);
    },
  });

  if (!contacts.data) {
    return contacts.isError ? (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <p className="text-sm text-danger" role="alert">
            {messageOf(contacts.error)}
          </p>
          <Button variant="outline" onClick={() => void contacts.refetch()}>
            <RefreshCw />
            Try again
          </Button>
        </CardContent>
      </Card>
    ) : (
      <Card className="h-64 animate-pulse bg-surface-variant/50" aria-label="Loading" />
    );
  }

  const rows = draft ?? rowsOf(contacts.data);
  const dirty = draft !== null && JSON.stringify(bodyOf(draft)) !== JSON.stringify(bodyOf(rowsOf(contacts.data)));
  const invalid = rows.some((r) => rowErrors(r).label || rowErrors(r).phone);
  const edit = (next: Row[]) => {
    setDraft(next);
    setSaved(false);
    save.reset();
  };
  const setRow = (key: string, change: Partial<Row>) => edit(rows.map((r) => (r.key === key ? { ...r, ...change } : r)));

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Always callable</CardTitle>
          <CardDescription>
            {kidName}'s phone can call these numbers even when it is locked. The emergency number always works.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {rows.length === 0 && (
            <div className="flex flex-col items-center gap-2 rounded-xl bg-surface-variant/60 py-8 text-center">
              <Phone className="size-6 text-muted" />
              <p className="text-sm text-muted">No numbers yet. Add Mum and Dad first.</p>
            </div>
          )}
          {rows.map((row, i) => {
            const errors = tried ? rowErrors(row) : {};
            return (
              <div key={row.key} role="group" aria-label={`Contact ${i + 1}`} className="flex items-start gap-2">
                <div className="grid flex-1 gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                  <div>
                    <Input
                      aria-label="Name"
                      placeholder="Name, like Mum"
                      value={row.label}
                      maxLength={40}
                      aria-invalid={errors.label !== undefined || undefined}
                      onChange={(e) => setRow(row.key, { label: e.target.value })}
                    />
                    {errors.label && <p className="mt-1 text-xs text-danger">{errors.label}</p>}
                  </div>
                  <div>
                    <Input
                      aria-label="Phone number"
                      placeholder="0412 345 678"
                      type="tel"
                      inputMode="tel"
                      autoComplete="off"
                      value={row.phone}
                      aria-invalid={errors.phone !== undefined || undefined}
                      onChange={(e) => setRow(row.key, { phone: e.target.value })}
                    />
                    {errors.phone && <p className="mt-1 text-xs text-danger">{errors.phone}</p>}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${row.label.trim() || 'this number'}`}
                  onClick={() => edit(rows.filter((r) => r.key !== row.key))}
                >
                  <X />
                </Button>
              </div>
            );
          })}
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            disabled={rows.length >= MAX_CONTACTS}
            onClick={() => edit([...rows, { key: crypto.randomUUID(), label: '', phone: '' }])}
          >
            <Plus />
            {rows.length >= MAX_CONTACTS ? `${MAX_CONTACTS} numbers at most` : 'Add a number'}
          </Button>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-end gap-3">
        <p aria-live="polite" className="mr-auto text-sm">
          {save.error ? (
            <span className="text-danger">{messageOf(save.error)}</span>
          ) : saved ? (
            <span className="flex items-center gap-1.5 text-primary">
              <Check className="size-4" />
              Saved.
            </span>
          ) : dirty ? (
            <span className="text-muted">Unsaved changes</span>
          ) : null}
        </p>
        {dirty && (
          <Button
            variant="ghost"
            disabled={save.isPending}
            onClick={() => {
              setDraft(null);
              setTried(false);
              save.reset();
            }}
          >
            Undo changes
          </Button>
        )}
        <Button
          disabled={!dirty || save.isPending}
          onClick={() => {
            setTried(true);
            if (!invalid) save.mutate(rows);
          }}
        >
          {save.isPending && <Loader2 className="animate-spin" />}
          Save numbers
        </Button>
      </div>
    </div>
  );
}
```

### 5.10 `web/src/components/add-device-dialog.tsx`

```tsx
import type { Device, DeviceForm, EnrolmentCode } from '@screentime/schemas';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, Loader2, Monitor, RefreshCw, Smartphone, Tablet } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ApiError } from '@/lib/api';
import { api } from '@/lib/auth';
import { countdownText, FORM_NAMES, spacedCode } from '@/lib/kid';
import { useDevices } from '@/pages/kids';

const FORMS: { form: DeviceForm; icon: typeof Smartphone; detail: string }[] = [
  { form: 'phone', icon: Smartphone, detail: 'Android phone. Counts as Phone time.' },
  { form: 'tablet', icon: Tablet, detail: 'Android tablet. Counts as Screens time.' },
  { form: 'pc', icon: Monitor, detail: 'Windows PC account. Counts as Screens time.' },
];

/** "phone", "tablet", "PC", for the middle of a sentence. */
function formWord(form: DeviceForm): string {
  return form === 'pc' ? 'PC' : FORM_NAMES[form].toLowerCase();
}

/** Re-renders every second while mounted. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function CodeStep({
  kidId,
  kidName,
  form,
  code,
  knownIds,
  onNewCode,
  busy,
  onDone,
}: {
  kidId: string;
  kidName: string;
  form: DeviceForm;
  code: EnrolmentCode;
  knownIds: Set<string>;
  onNewCode: () => void;
  busy: boolean;
  onDone: () => void;
}) {
  const now = useNow();
  const expired = new Date(code.expiresAt).getTime() <= now.getTime();
  // Looks for the new device every 3 seconds while the code is shown.
  const devices = useDevices(expired ? undefined : 3000);
  const added = devices.data?.find((d) => d.kidId === kidId && !knownIds.has(d.id));

  if (added) {
    return (
      <>
        <DialogTitle>{added.name} is connected</DialogTitle>
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <CircleCheck className="size-16 text-primary" />
          <p className="text-sm text-muted">
            It now counts toward {kidName}'s {added.pool === 'phone' ? 'Phone' : 'Screens'} time. You can rename it on the
            Devices tab.
          </p>
        </div>
        <Button onClick={onDone}>Done</Button>
      </>
    );
  }

  return (
    <>
      <DialogTitle>
        Add {kidName}'s {formWord(form)}
      </DialogTitle>
      <DialogDescription>
        {form === 'pc'
          ? `On the PC, a parent runs the ScreenTime installer and types this code for ${kidName}'s Windows account.`
          : `On ${kidName}'s ${formWord(form)}, open ScreenTime and tap Scan QR code, or Enter code.`}
      </DialogDescription>
      {form !== 'pc' && (
        <div className="flex justify-center">
          <div className={expired ? 'rounded-2xl bg-white p-3 opacity-20' : 'rounded-2xl bg-white p-3'}>
            <QRCodeSVG value={code.qrPayload} size={208} fgColor="#1C1917" bgColor="#FFFFFF" marginSize={1} title="Enrolment QR code" />
          </div>
        </div>
      )}
      <div className="text-center">
        {form !== 'pc' && <p className="text-sm text-muted">Or type this code</p>}
        <p
          className={expired ? 'text-5xl font-semibold tracking-widest text-muted tabular-nums line-through' : 'text-5xl font-semibold tracking-widest tabular-nums'}
          data-testid="enrol-code"
        >
          {spacedCode(code.code)}
        </p>
        <p className="mt-2 text-sm text-muted tabular-nums" aria-live="polite">
          {expired ? 'This code has expired.' : `Works once. Expires in ${countdownText(code.expiresAt, now)}`}
        </p>
      </div>
      {expired ? (
        <Button onClick={onNewCode} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          Make a new code
        </Button>
      ) : (
        <p className="flex items-center justify-center gap-2 text-sm text-muted">
          <Loader2 className="size-4 animate-spin" />
          Waiting for the device…
        </p>
      )}
    </>
  );
}

/** The dialog's body: mounted fresh each time it opens. */
function AddDeviceBody({ kidId, kidName, onDone }: { kidId: string; kidName: string; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<DeviceForm | null>(null);
  // The kid's devices when the dialog opened: a device that is not in this set is the new one.
  const [knownIds] = useState(
    () => new Set((queryClient.getQueryData<Device[]>(['devices']) ?? []).filter((d) => d.kidId === kidId).map((d) => d.id)),
  );
  const makeCode = useMutation({
    mutationFn: (f: DeviceForm) => api.post<EnrolmentCode>(`/v1/kids/${kidId}/enrolment-codes`, { form: f }),
  });

  if (form && makeCode.data) {
    return (
      <CodeStep
        kidId={kidId}
        kidName={kidName}
        form={form}
        code={makeCode.data}
        knownIds={knownIds}
        busy={makeCode.isPending}
        onNewCode={() => makeCode.mutate(form)}
        onDone={onDone}
      />
    );
  }

  return (
    <>
      <DialogTitle>Add a device for {kidName}</DialogTitle>
      <DialogDescription>What are you adding? You get a code that works once, for 10 minutes.</DialogDescription>
      <div className="flex flex-col gap-2">
        {FORMS.map(({ form: f, icon: Icon, detail }) => (
          <button
            key={f}
            type="button"
            disabled={makeCode.isPending}
            onClick={() => {
              setForm(f);
              makeCode.mutate(f);
            }}
            className="flex items-center gap-4 rounded-2xl border border-outline p-4 text-left transition-colors outline-none hover:bg-surface-variant focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
          >
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              {makeCode.isPending && form === f ? <Loader2 className="size-5 animate-spin" /> : <Icon className="size-5" />}
            </span>
            <span>
              <span className="block font-medium">{FORM_NAMES[f]}</span>
              <span className="block text-sm text-muted">{detail}</span>
            </span>
          </button>
        ))}
      </div>
      {makeCode.error && (
        <p role="alert" className="text-sm text-danger">
          {makeCode.error instanceof ApiError ? makeCode.error.message : 'Something went wrong. Try again.'}
        </p>
      )}
    </>
  );
}

/** docs/SPEC.md §11.3 and §16.4 Add device: pick Phone, Tablet or PC, then a QR code and the 6 digits with a 10-minute countdown. */
export function AddDeviceDialog({
  open,
  kidId,
  kidName,
  onClose,
}: {
  open: boolean;
  kidId: string;
  kidName: string;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>{open && <AddDeviceBody kidId={kidId} kidName={kidName} onDone={onClose} />}</DialogContent>
    </Dialog>
  );
}
```

### 5.11 `web/src/components/devices-panel.tsx`

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

const DURATIONS: { value: ParentModeDuration; label: string }[] = [
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

### 5.12 `web/src/pages/today.tsx`

The same as before with three changes: `PoolRow` is exported, the chips are a new exported `ChipList` component, and the kid's name on each card links to the kid's page.

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

export function PoolRow({ kid, pool, onAdjust }: { kid: TodayKid; pool: TodayPool; onAdjust: () => void }) {
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

/** The status chips under a kid (docs/SPEC.md §16.4); nothing when there are none. */
export function ChipList({ chips }: { chips: Chip[] }) {
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((chip) => (
        <span key={chip.text} className={cn('rounded-full px-3 py-1 text-xs font-medium', CHIP[chip.tone])}>
          {chip.text}
        </span>
      ))}
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
          <h2 className="text-lg font-semibold">
            <Link to="/kids/$kidId" params={{ kidId: kid.id }} className="underline-offset-4 hover:underline">
              {kid.name}
            </Link>
          </h2>
        </div>
        {kid.pools.map((pool) => (
          <PoolRow key={pool.pool} kid={kid} pool={pool} onAdjust={() => onAdjust(pool.pool)} />
        ))}
        <ChipList chips={chips} />
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

### 5.13 `web/src/pages/kids.tsx`

The kids list, and the `useKids` and `useDevices` queries the other files use.

```tsx
import type { Device, Kid } from '@screentime/schemas';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { ChevronRight, Plus, RefreshCw, Users } from 'lucide-react';
import { useState } from 'react';
import { KidAvatar } from '@/components/kid-avatar';
import { KidDialog } from '@/components/kid-dialog';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { api } from '@/lib/auth';

export function useKids() {
  return useQuery({ queryKey: ['kids'], queryFn: () => api.get<Kid[]>('/v1/kids') });
}

/** Every device in the family. `poll` (ms) while waiting for a new device to enrol. */
export function useDevices(poll?: number) {
  return useQuery({ queryKey: ['devices'], queryFn: () => api.get<Device[]>('/v1/devices'), refetchInterval: poll });
}

function devicesText(devices: Device[]): string {
  if (devices.length === 0) return 'No devices yet';
  return devices.map((d) => d.name).join(', ');
}

/** docs/SPEC.md §16.5 Kids: one row per kid, linking to the kid's page, and Add kid. */
export function KidsPage() {
  const kids = useKids();
  const devices = useDevices();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const addButton = (
    <Button onClick={() => setAdding(true)}>
      <Plus />
      Add kid
    </Button>
  );

  return (
    <>
      <PageHeader title="Kids" description="Schedules, devices and contacts." actions={kids.data?.length ? addButton : undefined} />
      {kids.isError && !kids.data ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <p className="text-sm text-danger" role="alert">
              {kids.error instanceof ApiError ? kids.error.message : 'Something went wrong. Try again.'}
            </p>
            <Button variant="outline" onClick={() => void kids.refetch()}>
              <RefreshCw />
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : !kids.data ? (
        <div className="flex flex-col gap-3" aria-label="Loading">
          {[0, 1].map((i) => (
            <Card key={i} className="h-20 animate-pulse bg-surface-variant/50" />
          ))}
        </div>
      ) : kids.data.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-surface-variant text-muted">
              <Users className="size-6" />
            </span>
            <p className="font-medium">No kids yet</p>
            <p className="max-w-sm text-sm text-muted">Add a kid, then add their phone, tablet or PC.</p>
            {addButton}
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {kids.data.map((kid) => (
            <Link
              key={kid.id}
              to="/kids/$kidId"
              params={{ kidId: kid.id }}
              className="rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Card className="flex items-center gap-4 p-4 transition-colors hover:bg-surface-variant/50">
                <KidAvatar name={kid.name} color={kid.avatarColor} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{kid.name}</p>
                  <p className="truncate text-sm text-muted">
                    {devices.data ? devicesText(devices.data.filter((d) => d.kidId === kid.id)) : '\u00a0'}
                  </p>
                </div>
                <ChevronRight className="size-5 text-muted" />
              </Card>
            </Link>
          ))}
        </div>
      )}
      <KidDialog
        open={adding}
        kid={null}
        onClose={() => setAdding(false)}
        onSaved={(kid) => void navigate({ to: '/kids/$kidId', params: { kidId: kid.id } })}
      />
    </>
  );
}
```

### 5.14 `web/src/pages/kid.tsx`

```tsx
import type { Kid, Pool } from '@screentime/schemas';
import { Link } from '@tanstack/react-router';
import { ChevronLeft, Pencil, RefreshCw, UserX } from 'lucide-react';
import { useState } from 'react';
import { AdjustDialog } from '@/components/adjust-dialog';
import { ContactsEditor } from '@/components/contacts-editor';
import { DevicesPanel } from '@/components/devices-panel';
import { KidAvatar } from '@/components/kid-avatar';
import { KidDialog } from '@/components/kid-dialog';
import { ScheduleEditor } from '@/components/schedule-editor';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ApiError } from '@/lib/api';
import { kidChips } from '@/lib/today';
import { useKids } from '@/pages/kids';
import { ChipList, PoolRow, useToday } from '@/pages/today';

function TodayPanel({ kid }: { kid: Kid }) {
  const today = useToday();
  const [adjusting, setAdjusting] = useState<Pool | null>(null);
  const todayKid = today.data?.kids.find((k) => k.id === kid.id) ?? null;
  if (!todayKid || !today.data) return <Card className="h-48 animate-pulse bg-surface-variant/50" aria-label="Loading" />;
  return (
    <Card>
      <CardContent className="flex flex-col gap-5">
        {todayKid.pools.map((pool) => (
          <PoolRow key={pool.pool} kid={todayKid} pool={pool} onAdjust={() => setAdjusting(pool.pool)} />
        ))}
        <ChipList chips={kidChips(todayKid, new Date(today.data.serverTime))} />
      </CardContent>
      <AdjustDialog kid={adjusting ? todayKid : null} pool={adjusting ?? 'screens'} onClose={() => setAdjusting(null)} />
    </Card>
  );
}

function BackLink() {
  return (
    <Link
      to="/kids"
      className="mb-4 inline-flex items-center gap-1 rounded-full text-sm font-medium text-muted outline-none hover:text-on-surface focus-visible:ring-2 focus-visible:ring-primary"
    >
      <ChevronLeft className="size-4" />
      Kids
    </Link>
  );
}

/** docs/SPEC.md §16.5 Kid detail: tabs Today, Schedule, Devices, Contacts. */
export function KidPage({ kidId }: { kidId: string }) {
  const kids = useKids();
  const [editing, setEditing] = useState(false);
  const kid = kids.data?.find((k) => k.id === kidId);

  if (!kids.data) {
    return (
      <>
        <BackLink />
        {kids.isError ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
              <p className="text-sm text-danger" role="alert">
                {kids.error instanceof ApiError ? kids.error.message : 'Something went wrong. Try again.'}
              </p>
              <Button variant="outline" onClick={() => void kids.refetch()}>
                <RefreshCw />
                Try again
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card className="h-64 animate-pulse bg-surface-variant/50" aria-label="Loading" />
        )}
      </>
    );
  }

  if (!kid) {
    return (
      <>
        <BackLink />
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-surface-variant text-muted">
              <UserX className="size-6" />
            </span>
            <p className="font-medium">This kid is not in your family</p>
            <p className="max-w-sm text-sm text-muted">They may have been removed. Pick a kid from the list.</p>
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <>
      <BackLink />
      <div className="mb-6 flex items-center gap-4">
        <KidAvatar name={kid.name} color={kid.avatarColor} className="size-14 text-xl" />
        <h1 className="min-w-0 flex-1 truncate text-2xl font-semibold tracking-tight">{kid.name}</h1>
        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
          <Pencil />
          Edit
        </Button>
      </div>
      <Tabs defaultValue="today">
        <TabsList aria-label={`${kid.name}'s settings`}>
          <TabsTrigger value="today">Today</TabsTrigger>
          <TabsTrigger value="schedule">Schedule</TabsTrigger>
          <TabsTrigger value="devices">Devices</TabsTrigger>
          <TabsTrigger value="contacts">Contacts</TabsTrigger>
        </TabsList>
        <TabsContent value="today">
          <TodayPanel kid={kid} />
        </TabsContent>
        <TabsContent value="schedule">
          <ScheduleEditor kidId={kid.id} kidName={kid.name} />
        </TabsContent>
        <TabsContent value="devices">
          <DevicesPanel kidId={kid.id} kidName={kid.name} />
        </TabsContent>
        <TabsContent value="contacts">
          <ContactsEditor kidId={kid.id} kidName={kid.name} />
        </TabsContent>
      </Tabs>
      <KidDialog open={editing} kid={kid} onClose={() => setEditing(false)} />
    </>
  );
}
```

### 5.15 `web/src/router.tsx`

The same as before, except `/kids` uses `KidsPage` and there is a new `/kids/$kidId` route.

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

### 5.16 `web/test/kid.test.ts`

```typescript
import type { ScheduleDay, ScheduleInput } from '@screentime/schemas';
import { describe, expect, it } from 'vitest';
import { countdownText, lastSeenText, normalisePhone, spacedCode } from '../src/lib/kid';
import {
  allowanceOptions,
  copyMondayToWeekdays,
  copySaturdayToWeekend,
  formatClock,
  hasErrors,
  scheduleErrors,
  timeOptions,
} from '../src/lib/schedule';

const NOW = new Date('2026-10-26T01:00:00Z');

function week(): ScheduleDay[] {
  return [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
    weekday,
    screensMin: weekday * 15,
    phoneMin: 60,
    wake: '07:00',
    bedtime: '20:30',
  }));
}

describe('schedule options', () => {
  it('writes times of day in 12-hour form, with midnight for the end of the day', () => {
    expect(formatClock('00:00')).toBe('12:00 am');
    expect(formatClock('07:05')).toBe('7:05 am');
    expect(formatClock('12:30')).toBe('12:30 pm');
    expect(formatClock('20:30')).toBe('8:30 pm');
    expect(formatClock('24:00')).toBe('midnight');
  });

  it('offers wake-up from midnight to 11:45 pm and bedtime from 12:15 am to midnight', () => {
    const wake = timeOptions('wake', '07:00');
    const bedtime = timeOptions('bedtime', '20:30');
    expect(wake).toHaveLength(96);
    expect(wake[0]).toEqual({ value: '00:00', label: '12:00 am' });
    expect(wake.at(-1)).toEqual({ value: '23:45', label: '11:45 pm' });
    expect(bedtime).toHaveLength(96);
    expect(bedtime[0]?.value).toBe('00:15');
    expect(bedtime.at(-1)).toEqual({ value: '24:00', label: 'midnight' });
  });

  it('keeps a saved value that is off the 15-minute grid, in order', () => {
    const options = timeOptions('bedtime', '20:20');
    expect(options).toHaveLength(97);
    const i = options.findIndex((o) => o.value === '20:20');
    expect(options[i - 1]?.value).toBe('20:15');
    expect(options[i + 1]?.value).toBe('20:30');
    expect(allowanceOptions(800).at(-1)).toEqual({ value: 800, label: '13h 20m' });
  });

  it('offers allowances from no time to 12 hours in 15-minute steps', () => {
    const options = allowanceOptions(120);
    expect(options).toHaveLength(49);
    expect(options[0]).toEqual({ value: 0, label: 'No time' });
    expect(options[1]).toEqual({ value: 15, label: '15m' });
    expect(options[6]).toEqual({ value: 90, label: '1h 30m' });
    expect(options.at(-1)).toEqual({ value: 720, label: '12h 00m' });
  });
});

describe('schedule copy buttons', () => {
  it('copies Monday to Tuesday to Friday, keeping their weekdays', () => {
    const days = copyMondayToWeekdays(week());
    expect(days.map((d) => d.weekday)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(days.map((d) => d.screensMin)).toEqual([15, 15, 15, 15, 15, 90, 105]);
  });

  it('copies Saturday to Sunday', () => {
    const days = copySaturdayToWeekend(week());
    expect(days.map((d) => d.screensMin)).toEqual([15, 30, 45, 60, 75, 90, 90]);
    expect(days[6]?.weekday).toBe(7);
  });
});

describe('schedule errors', () => {
  it('flags a bedtime at or before wake-up, and warnings in the wrong order', () => {
    const days = week();
    days[2] = { ...days[2]!, wake: '21:00', bedtime: '20:30' };
    const input: ScheduleInput = { warn1Min: 5, warn2Min: 5, days };
    const errors = scheduleErrors(input);
    expect(errors.days).toEqual({ 3: 'Bedtime must be after wake-up.' });
    expect(errors.warnings).toBe('The first warning must come before the second.');
    expect(hasErrors(errors)).toBe(true);
    expect(hasErrors(scheduleErrors({ warn1Min: 15, warn2Min: 5, days: week() }))).toBe(false);
  });
});

describe('device helpers', () => {
  it('says when a device was last seen', () => {
    expect(lastSeenText(null, NOW)).toBe('Never connected');
    expect(lastSeenText('2026-10-26T00:59:30Z', NOW)).toBe('Seen just now');
    expect(lastSeenText('2026-10-26T00:48:00Z', NOW)).toBe('Seen 12 min ago');
    expect(lastSeenText('2026-10-25T22:00:00Z', NOW)).toBe('Seen 3h ago');
    expect(lastSeenText('2026-10-25T00:00:00Z', NOW)).toBe('Seen 1 day ago');
    expect(lastSeenText('2026-10-23T00:00:00Z', NOW)).toBe('Seen 3 days ago');
  });

  it('counts down to the end of an enrolment code', () => {
    expect(countdownText('2026-10-26T01:10:00Z', NOW)).toBe('10:00');
    expect(countdownText('2026-10-26T01:00:59.200Z', NOW)).toBe('1:00');
    expect(countdownText('2026-10-26T01:00:05Z', NOW)).toBe('0:05');
    expect(countdownText('2026-10-26T00:59:00Z', NOW)).toBe('0:00');
    expect(spacedCode('123456')).toBe('123 456');
  });

  it('turns typed phone numbers into international format', () => {
    expect(normalisePhone('0412 345 678')).toBe('+61412345678');
    expect(normalisePhone('(02) 9876-5432')).toBe('+61298765432');
    expect(normalisePhone('+61 412 345 678')).toBe('+61412345678');
    expect(normalisePhone('+1 (415) 555-0100')).toBe('+14155550100');
    expect(normalisePhone('0412 345')).toBeNull();
    expect(normalisePhone('412345678')).toBeNull();
    expect(normalisePhone('')).toBeNull();
  });
});
```

## 6. Detailed spec

### 6.1 Kids list (`/kids`)

- Heading `Kids`, description `Schedules, devices and contacts.`, and an `Add kid` button at the top right once there is at least one kid.
- One card per kid, oldest first: 40 px avatar, the name in semibold, and under it the kid's device names separated by commas, or `No devices yet`. The whole card is a link to `/kids/<id>`.
- No kids: `No kids yet`, `Add a kid, then add their phone, tablet or PC.` and the `Add kid` button.
- `Add kid` opens the kid dialog. After saving, the app goes to the new kid's page.

### 6.2 Kid dialog

- Title `Add a kid` or `Edit <name>`. A 56 px avatar preview, a `Name` field (40 characters at most), and the 8 colours of SPEC §16.1 as round swatches (radio buttons named Teal, Violet, Pink, Blue, Orange, Green, Gold, Slate; the picked one has a ring and a check). Button `Add kid` or `Save`, disabled while the name is blank.

### 6.3 Kid page (`/kids/<id>`)

- A `Kids` back link, then a 56 px avatar, the name in 24 px semibold and an `Edit` button.
- Tabs `Today`, `Schedule`, `Devices`, `Contacts`; Today is open first. Tabs fill the width on phones.
- A kid id that is not in the family shows `This kid is not in your family`.

### 6.4 Schedule tab

- **Week** card: one row per day, Monday to Sunday. On 768 px and wider the four selects sit in one row under the column headings `Screens`, `Phone`, `Wake-up`, `Bedtime`; on phones each day is a block with the day name and a 2 × 2 grid of labelled selects.
- Allowance selects: `No time`, `15m`, `30m` … `12h 00m` in 15-minute steps. Wake-up: `12:00 am` to `11:45 pm`; bedtime: `12:15 am` to `midnight` (`24:00`, the end of the day). A saved value that is not on the 15-minute grid is added to its list, so nothing is lost.
- `Copy Monday to weekdays` makes Tuesday to Friday the same as Monday. `Copy Saturday to weekend` makes Sunday the same as Saturday.
- A bedtime at or before wake-up marks the bedtime select red and shows `Bedtime must be after wake-up.` under the row.
- **Warnings** card: `First warning` (10, 15, 20, 30, 45 or 60 min before) and `Second warning` (1, 2, 3, 5 or 10 min before). When the first is not more than the second: `The first warning must come before the second.`
- Under the cards: `Unsaved changes` and `Undo changes` once something changed, and `Save schedule`, which is disabled with no change or with an error. Saving writes a new schedule version, refreshes Today and shows `Saved. <kid>'s devices pick it up on their next sync.`

### 6.5 Devices tab

- A card titled `Devices` with `Phones count as Phone time. Tablets and PCs share Screens time.` and an `Add device` button.
- One row per device of this kid: a phone, tablet or monitor icon, the name, then `<Pool> time · <model> · <OS version>` (the model is left out while the name still contains it), then `In use now` (teal chip) or `Seen just now`, `Seen 12 min ago`, `Seen 3h ago`, `Seen 2 days ago` or `Never connected`, and a grey `Parent mode · 10 min` (or `· until ended`) chip while parent mode is on.
- A `…` button opens a menu: `Parent mode…` (or `End parent mode` while it is on), `Rename…`, and, after a line, `Remove device…` in red.
  - Parent mode dialog: `2 min`, `5 min`, `15 min` (picked first), `1 hour`, `Until I end it`, and `Start parent mode`.
  - Rename dialog: a `Name` field and `Save`.
  - Remove dialog: `Remove <name>?`, `It is signed out of ScreenTime and stops limiting time. To add it again you need a new code.`, `Cancel` and a red `Remove`.
- No devices: `No devices yet. Add <kid>'s phone, tablet or PC.`

### 6.6 Add device dialog

- First step: `Add a device for <kid>`, `What are you adding? You get a code that works once, for 10 minutes.`, and three large buttons: `Phone` (Android phone. Counts as Phone time.), `Tablet` (Android tablet. Counts as Screens time.), `PC` (Windows PC account. Counts as Screens time.). Pressing one asks the server for a code.
- Phone or tablet: `Add <kid>'s phone`, `On <kid>'s phone, open ScreenTime and tap Scan QR code, or Enter code.`, a 208 px QR code of `qrPayload` on a white square (also in dark mode, so cameras can read it), `Or type this code`, the code in 48 px as `123 456`, and `Works once. Expires in 9:41` counting down every second.
- PC: no QR code; `On the PC, a parent runs the ScreenTime installer and types this code for <kid>'s Windows account.` (SPEC §12.2, Install).
- While the code is valid the app asks for the device list every 3 seconds. When a new device of this kid appears: `<device name> is connected`, a large check, `It now counts toward <kid>'s <Pool> time. You can rename it on the Devices tab.` and `Done`.
- When the countdown reaches zero: the QR code fades, the code is struck through, `This code has expired.` and `Make a new code`.

### 6.7 Contacts tab

- **Always callable** card: `<kid>'s phone can call these numbers even when it is locked. The emergency number always works.`
- One row per number: a `Name` field (placeholder `Name, like Mum`), a `Phone number` field (placeholder `0412 345 678`), and an `X` button that removes the row. `Add a number` adds an empty row, up to 10 (then the button reads `10 numbers at most` and is disabled). With none: `No numbers yet. Add Mum and Dad first.`
- Numbers are saved in international format. Spaces, dashes, dots and brackets are dropped, and an Australian number that starts with 0 and has 10 digits gets `+61` in place of the 0 (`0412 345 678` becomes `+61412345678`). Anything else must already be `+` and 7 to 15 digits.
- Errors show only after `Save numbers` is pressed: `Type a name.` and `Type a number like 0412 345 678 or +61412345678.` A list with an error is not sent.
- `Unsaved changes`, `Undo changes` and `Save numbers` work like the schedule's; after saving: `Saved.`

## 7. Steps

All commands in PowerShell from `C:\Users\james\OpenCode\Testing\ScreenTime` unless stated otherwise.

1. Start from the latest `main` and create the branch:
   ```powershell
   git checkout main
   git pull origin main
   git checkout -b bob/card-024-kid-pages
   pnpm install --frozen-lockfile
   ```
   After the pull, `docs/cards/CARD-024-kid-pages.md` and `web/src/pages/today.tsx` (CARD-023) must exist, and `web/package.json` must list `"qrcode.react"`. If any of them is missing, run `git pull origin main` again, and if one is still missing, stop and ask James.
2. Replace 5.1, create 5.2 to 5.11, replace 5.12, create 5.13 and 5.14, and replace 5.15. Run `pnpm build` and `pnpm typecheck`. Commit: `CARD-024: add the kids pages`.
3. Create 5.16. Run `pnpm --filter @screentime/web test`. Commit: `CARD-024: add kid page tests`.
4. Run the acceptance checks in section 8.
5. Push and open the PR (section 10).
6. Wait for both CI checks to finish (`gh pr checks <number> --watch`).
7. Send James the handback report (section 12).

## 8. Acceptance criteria

Never put a real password, JWT secret, SMTP key, Firebase key, FCM token or device token in the PR or the handback.

- [ ] `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm typecheck` and `pnpm test` pass, and `git status --short pnpm-lock.yaml` is empty. `pnpm build` ends the web part with `✓ built in` (the 500 kB chunk warning of section 4 is expected). Without `TEST_DATABASE_URL`:
  - `packages/schemas`: `Tests  36 passed (36)`.
  - `packages/engine`: `Tests  27 passed (27)`.
  - `web`: `test/format.test.ts (3 tests)`, `test/api.test.ts (6 tests)`, `test/today.test.ts (9 tests)`, `test/kid.test.ts (10 tests)`, `Tests  28 passed (28)`.
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
  (curl.exe -s http://localhost:5173/src/pages/kid.tsx | Out-String).Length -gt 1000
  ```
  Both print `True`. (`| Out-String` joins curl's lines into one string; without it PowerShell gets a list of lines, as you found in CARD-023.) Stop `pnpm dev:web` with Ctrl+C. Claude checks the pages in a browser with test data after the PR is open; you do not need to sign in.
- [ ] `git status` does **not** list `deploy/.env` or anything in `web/dist/`.
- [ ] Both GitHub Actions checks are green on the PR: **TypeScript / typecheck and test** and **TypeScript / docker compose smoke test**. Wait for them (`gh pr checks <number> --watch`) before you write the handback.
- [ ] Only the expected files changed. `git diff --name-only main...HEAD` lists exactly these 16 files (in any order):
  ```
  web/src/components/add-device-dialog.tsx
  web/src/components/contacts-editor.tsx
  web/src/components/devices-panel.tsx
  web/src/components/kid-dialog.tsx
  web/src/components/schedule-editor.tsx
  web/src/components/ui/dropdown-menu.tsx
  web/src/components/ui/select.tsx
  web/src/components/ui/tabs.tsx
  web/src/lib/api.ts
  web/src/lib/kid.ts
  web/src/lib/schedule.ts
  web/src/pages/kid.tsx
  web/src/pages/kids.tsx
  web/src/pages/today.tsx
  web/src/router.tsx
  web/test/kid.test.ts
  ```

## 9. Tests

| File | What it asserts |
|---|---|
| `web/test/kid.test.ts` | `formatClock`: `12:00 am`, `7:05 am`, `12:30 pm`, `8:30 pm`, `midnight`. `timeOptions`: 96 wake-up times from `12:00 am` to `11:45 pm`, 96 bedtimes from `00:15` to `midnight`; a saved `20:20` is added between `20:15` and `20:30`. `allowanceOptions`: 49 options from `No time` to `12h 00m`, and a saved 800 minutes kept as `13h 20m`. The copy buttons keep each day's weekday. `scheduleErrors`: a Wednesday wake-up after bedtime and equal warnings. `lastSeenText` for never, under a minute, 12 minutes, 3 hours, 1 day and 3 days. `countdownText`: `10:00`, `1:00` (rounded up), `0:05`, `0:00`; `spacedCode`. `normalisePhone`: Australian mobile and landline with 0, numbers with `+`, and three that are not numbers. |

## 10. Git and pull request

1. Start from the latest `main` (step 1 above).
2. Commit in small logical commits (steps 2 and 3). Message format: `CARD-024: <what changed>`.
3. Before pushing, run every acceptance command again and make sure all pass.
4. Push: `git push -u origin bob/card-024-kid-pages`
5. Open a PR into `main` titled `CARD-024: Kids pages: schedule, devices, contacts, add device`. Write the body to `$env:TEMP\pr-body.md` (outside the repo) and run `gh pr create --base main --head bob/card-024-kid-pages --title "CARD-024: Kids pages: schedule, devices, contacts, add device" --body-file $env:TEMP\pr-body.md`. Body:
   ```markdown
   ## Card
   docs/cards/CARD-024-kid-pages.md

   ## What I did
   - ...

   ## Acceptance criteria
   - [x] install, build, typecheck, test — output: `...`
   - [x] contract unchanged
   - [x] database tests — output: `Tests  212 passed (212)`
   - [x] dev server serves the app — output: `True`, `True`
   - [x] deploy/.env and web/dist not tracked
   - [x] both CI checks green
   - [x] only expected files changed — output: 16 files

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

- **`Cannot find module 'qrcode.react'`**: your `main` is older than this card, or you skipped `pnpm install --frozen-lockfile`. Pull `main` and install again. Never run `pnpm add`.
- **Special characters**: copy `·` (U+00B7) and `…` (U+2026) exactly; do not replace them with `.` or `...`. Check with `Select-String -Path web\src\components\devices-panel.tsx -Pattern '…'`.
- **`curl` in PowerShell**: write `curl.exe`, not `curl`, and keep the `| Out-String` of section 8.
- **Every difference from the card is a deviation**, in any file, including tests, comments, test data and how you ran a check. List each one under "Deviations", even when you think it is harmless. In CARD-023 a test timestamp was changed from `00:30:00Z` to `00:30:30Z` and not listed: that is exactly what must be listed (better: not done).
- **Blank lines and formatting**: copy them exactly too.
- **A test fails**: do not change the test to make it pass, and do not skip it. Report it.

## 12. Handback report (required)

When the PR is open, your **last message to James** must be the handback report below, inside one fenced code block so James can copy it in one go and paste it to Claude. Claude checks every line of it against the PR, the CI logs and its own test run, so write only what you actually saw.

Rules:

- Every command line shows the **real** output you saw, copied, not retyped from the card. If you did not run a command, write `NOT RUN` and the reason. Never write the expected output from the card as if you saw it.
- "Deviations" lists every way your files differ from the card, including comments, wording and whitespace. If you think the card is wrong, quote the exact card line and say what is wrong with it.
- "Outside the repo" lists anything you changed on James's PC outside the repo folder (config files, global tools, environment variables). Write `None` if there was nothing.

The report, filled in:

````text
Claude, here is Bob's handback for CARD-024. Please review and merge if it is good.

CARD: CARD-024 Kids pages: schedule, devices, contacts, add device
PR: <full PR URL>
Branch: bob/card-024-kid-pages
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
