# CARD-025b: Settings

| Field | Value |
|---|---|
| Card | CARD-025b |
| Title | Settings |
| Size | M |
| Depends on | CARD-025 (merged to `main`) |
| Spec sections | docs/SPEC.md §9.2, §12, §12.3, §13, §16.5 |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-025b-settings` |
| PR title | `CARD-025b: Settings` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first. Rule 8 there is new: every temporary file goes in `C:\Users\james\OpenCode\Testing\temp\`.

The parent web app is in `web/` (package `@screentime/web`): React 19, Vite, TanStack Router and Query, Tailwind CSS v4 with the design tokens of SPEC §16.1, shadcn/ui-style components in `web/src/components/ui`, and the API client `api` in `web/src/lib/auth.tsx`, which throws `ApiError` with the server's message. CARD-022 to CARD-025 built sign-in, the layout, **Today**, **Kids**, the **Inbox** and the SOS banner. Imports inside `web/src` use the `@/` alias and have no file extension.

This card replaces the **Settings** placeholder with one page of five cards, all on APIs that already exist (CARD-012, CARD-016, CARD-019):

- **Parent code** (`GET /v1/family/parent-code`, `POST /v1/family/parent-code/rotate`): when a kid device is offline, a parent types a 6-digit code on it to start parent mode. The code is a TOTP (RFC 6238: HMAC-SHA-1, 30-second steps) made from the family's base32 secret. The web works it out in the browser with Web Crypto (`crypto.subtle`), so it never needs the server for a new code. It is hidden until **Show code**, so a kid looking at the screen does not see it.
- **Notifications** (`GET` and `PUT /v1/me/notification-prefs`): one switch per kind of alert, for the signed-in parent only. SOS, parent-mode requests and time requests are essential: they show **Always on** with a lock instead of a switch.
- **Messages kids can send** (`GET` and `PUT /v1/family/message-presets`): up to 10 ready-made messages, saved as one list in order, with move up and remove.
- **Parents** (`GET`, `POST /v1/family/parents`, `PATCH` and `DELETE /v1/family/parents/{id}`): add, edit and remove parents. You cannot remove yourself (the menu has no Remove for you).
- **Family** (`GET` and `PATCH /v1/family`): name, time zone and emergency number. After a save the app refreshes the sign-in, so every page uses the new time zone.

## 2. Goal

A signed-in parent opens http://localhost:5173/settings, sees the parent code, switches alerts on and off, edits the kids' ready-made messages, manages the parents and changes the family settings. The pure logic, including the official RFC 6238 test codes, is covered by Vitest tests.

## 3. Out of scope

Do **not** do any of these in this card:

- No server change, no change to `packages/schemas`, and the contract stays the same.
- No new npm packages and no lockfile change. `pnpm-lock.yaml`, `pnpm-workspace.yaml` and every `package.json` stay as they are on `main`. The switch uses `radix-ui`, which is already installed. Do not add an `otpauth` or `totp` package: 5.1 is the TOTP.
- No admin pages (CARD-026), no browser notifications, no QR code for the parent code, no drag-and-drop for the messages.
- Do not run the shadcn CLI. Do not change any file that is not listed in section 5.
- Never commit `deploy/.env`, `web/dist/`, a real JWT secret, an SMTP key, a Firebase key, an FCM token, a device token or a parent-code secret.

## 4. Tech and versions

Unchanged from `main`: Node 24, pnpm 11, TypeScript ^5.9, Vitest ^3.2, React ^19.3.1, Vite ^7.3.7, @tanstack/react-query ^5.104.5, @tanstack/react-router ^1.170.46, Tailwind CSS ^4.3.3, radix-ui ^1.8.1 (its `Switch`), lucide-react ^1.61.0. Nothing new to install.

Web Crypto (`crypto.subtle`) works only on `https://` pages and on `localhost` / `127.0.0.1`. That covers the dev server and production (`https://screentime.gallagherhome.au`). Node 24 has it too, so the Vitest tests run it for real.

`pnpm build` still prints the Vite warning `(!) Some chunks are larger than 500 kB after minification`, as in CARD-025. That is expected.

Docker Desktop must be running for the server's database tests (check: `docker version` prints a `Server:` section).

## 5. Files

Create or change exactly these files. Paths are relative to the repo root. Copy every code block exactly, character for character, blank lines included. This card is UTF-8; if you see `Â` or `â€` anywhere, you are reading it with the wrong encoding: open it as UTF-8, and do not report it as a card error. Some strings use characters that look like plain ones but are not: `…` (one character, U+2026, not three dots) at the end of menu items and a placeholder, `·` (U+00B7) in the code placeholder `··· ···`, and `§` (U+00A7) in comments. Copy them exactly.

| File | Action |
|---|---|
| `web/src/lib/totp.ts` | create (5.1) |
| `web/src/lib/settings.ts` | create (5.2) |
| `web/src/components/ui/switch.tsx` | create (5.3) |
| `web/src/components/parent-code-card.tsx` | create (5.4) |
| `web/src/components/notifications-card.tsx` | create (5.5) |
| `web/src/components/presets-card.tsx` | create (5.6) |
| `web/src/components/parents-card.tsx` | create (5.7) |
| `web/src/components/family-card.tsx` | create (5.8) |
| `web/src/pages/settings.tsx` | create (5.9) |
| `web/src/router.tsx` | replace (5.10) |
| `web/test/totp.test.ts` | create (5.11) |
| `web/test/settings.test.ts` | create (5.12) |

That is 12 files.

### 5.1 `web/src/lib/totp.ts`

The parent code. `base32Decode` turns the secret into bytes, `totp` signs the 30-second step number with HMAC-SHA-1 and keeps 6 digits (RFC 4226 "dynamic truncation"), `secondsLeft` drives the ring. The return type `Uint8Array<ArrayBuffer>` is needed: Web Crypto in TypeScript 5.9 refuses a plain `Uint8Array`.

```typescript
/**
 * The parent code (docs/SPEC.md §12.3): a 6-digit TOTP (RFC 6238, HMAC-SHA-1, 30 s step) from the family's
 * base32 parent-code secret. Kid devices check it offline, accepting the step before and after.
 */

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Seconds each code lasts. */
export const STEP_SEC = 30;

/** RFC 4648 base32 to bytes. Padding, spaces and case are ignored; any other character throws. */
export function base32Decode(text: string): Uint8Array<ArrayBuffer> {
  const clean = text.replace(/[\s=]/g, '').toUpperCase();
  const out = new Uint8Array(new ArrayBuffer(Math.floor((clean.length * 5) / 8)));
  let bits = 0;
  let value = 0;
  let index = 0;
  for (const char of clean) {
    const digit = BASE32.indexOf(char);
    if (digit < 0) throw new Error(`Not base32: ${char}`);
    value = ((value << 5) | digit) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out[index++] = (value >>> (bits - 8)) & 0xff;
      bits -= 8;
    }
  }
  return out;
}

/** The code for the step that holds `atMs` (Unix milliseconds), with leading zeros. */
export async function totp(secret: string, atMs: number, digits = 6): Promise<string> {
  const counter = Math.floor(atMs / 1000 / STEP_SEC);
  const message = new DataView(new ArrayBuffer(8));
  // The counter fits in 53 bits: the high and low 32 bits, big-endian.
  message.setUint32(0, Math.floor(counter / 2 ** 32));
  message.setUint32(4, counter >>> 0);
  const key = await crypto.subtle.importKey('raw', base32Decode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, message.buffer));
  // RFC 4226 dynamic truncation.
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  const binary =
    (((mac[offset] ?? 0) & 0x7f) << 24) |
    ((mac[offset + 1] ?? 0) << 16) |
    ((mac[offset + 2] ?? 0) << 8) |
    (mac[offset + 3] ?? 0);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/** Whole seconds until the code shown at `atMs` changes: 30 down to 1. */
export function secondsLeft(atMs: number): number {
  return STEP_SEC - (Math.floor(atMs / 1000) % STEP_SEC);
}
```

### 5.2 `web/src/lib/settings.ts`

Words for each notification switch, the message limits, the checks for the family form, and the time-zone list.

```typescript
import type { NotificationKind } from '@screentime/schemas';

/** What each notification switch means, in the words of docs/SPEC.md §13. The server sends the order. */
export const NOTIFICATION_TEXT: Record<NotificationKind, { title: string; detail: string }> = {
  sos: { title: 'SOS', detail: 'When a kid presses SOS on their phone, and every update after.' },
  'parent_mode.request': { title: 'Parent mode requests', detail: 'When a kid asks a parent to unlock a device.' },
  time_request: { title: 'Requests for more time', detail: 'When a kid asks for more time.' },
  kid_message: { title: 'Messages from kids', detail: 'When a kid sends you a message.' },
  tamper: {
    title: 'Tampering',
    detail: 'When a device sees its clock, time zone or protection changed, or blocks a call.',
  },
  'parent_mode.used': { title: 'Parent mode started', detail: 'Each time parent mode starts on a device.' },
  overspend: { title: 'Went over while offline', detail: 'When an offline device used more time than was left.' },
  'device.offline': { title: 'Device offline', detail: "When a kid's device has not been seen for 6 hours." },
  'device.enrolled': { title: 'Device added', detail: 'When a new device is added for a kid.' },
  'grant.by_other_parent': { title: 'Time changed by another parent', detail: 'When another parent adds or takes away time.' },
};

/** The API's limits (packages/schemas family.ts MessagePresetsPut). */
export const MAX_PRESETS = 10;
export const PRESET_MAX_LENGTH = 160;

/** One error per preset, or undefined when it is fine. */
export function presetErrors(texts: string[]): (string | undefined)[] {
  return texts.map((text) => {
    const trimmed = text.trim();
    if (!trimmed) return 'Type a message, or remove it.';
    if (trimmed.length > PRESET_MAX_LENGTH) return `Keep it to ${PRESET_MAX_LENGTH} characters.`;
    return undefined;
  });
}

export interface FamilyDraft {
  name: string;
  timezone: string;
  emergencyNumber: string;
}

export function familyErrors(draft: FamilyDraft): { name?: string; emergencyNumber?: string } {
  return {
    name: draft.name.trim() ? undefined : 'Type a family name.',
    emergencyNumber: /^[0-9]{2,6}$/.test(draft.emergencyNumber.trim()) ? undefined : 'Use 2 to 6 digits, like 000.',
  };
}

/** Every IANA time zone this browser knows, sorted, always including `current`. */
export function timeZones(current: string): string[] {
  let zones: string[] = [];
  try {
    zones = Intl.supportedValuesOf('timeZone');
  } catch {
    // An old browser: offer only the current zone.
  }
  return [...new Set([...zones, current])].sort();
}

/** "Australia/Sydney" reads as "Australia / Sydney"; "America/New_York" as "America / New York". */
export function zoneLabel(zone: string): string {
  return zone.replaceAll('_', ' ').replaceAll('/', ' / ');
}
```

### 5.3 `web/src/components/ui/switch.tsx`

A shadcn/ui-style switch on `radix-ui`'s `Switch`: teal when on, grey when off. Screen readers hear it as a switch.

```tsx
import { Switch as SwitchPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** shadcn/ui switch with our tokens: a 48 x 28 px track, teal when on. */
export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-60 data-[state=checked]:bg-primary data-[state=unchecked]:bg-muted/40',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="block size-6 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-5"
      />
    </SwitchPrimitive.Root>
  );
}
```

### 5.4 `web/src/components/parent-code-card.tsx`

```tsx
import type { ParentCodeSecret } from '@screentime/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, KeyRound, Loader2, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ApiError } from '@/lib/api';
import { api } from '@/lib/auth';
import { spacedCode } from '@/lib/kid';
import { STEP_SEC, secondsLeft, totp } from '@/lib/totp';

function messageOf(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong. Try again.';
}

const RADIUS = 18;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** A ring that empties as the code's 30 seconds run out, with the seconds in the middle. */
function CountdownRing({ left }: { left: number }) {
  return (
    <span className="relative flex size-11 shrink-0 items-center justify-center" aria-hidden>
      <svg viewBox="0 0 44 44" className="absolute inset-0 -rotate-90">
        <circle cx="22" cy="22" r={RADIUS} fill="none" strokeWidth="4" className="stroke-surface-variant" />
        <circle
          cx="22"
          cy="22"
          r={RADIUS}
          fill="none"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - left / STEP_SEC)}
          className={left <= 5 ? 'stroke-warning' : 'stroke-primary'}
        />
      </svg>
      <span className="text-xs font-semibold tabular-nums">{left}</span>
    </span>
  );
}

/** The code of the current 30-second step, worked out in the browser. Null until the first one is ready. */
function useParentCode(secret: string | undefined): { code: string | null; left: number } {
  const [now, setNow] = useState(() => Date.now());
  const [result, setResult] = useState<{ key: string; code: string } | null>(null);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const step = Math.floor(now / 1000 / STEP_SEC);
  const key = `${secret ?? ''}:${step}`;
  useEffect(() => {
    if (!secret) return;
    let live = true;
    void totp(secret, step * STEP_SEC * 1000).then((code) => {
      if (live) setResult({ key, code });
    });
    return () => {
      live = false;
    };
  }, [secret, step, key]);
  return { code: result?.key === key ? result.code : null, left: secondsLeft(now) };
}

/**
 * docs/SPEC.md §12.3: when a kid device is offline, a parent types this code on it to start parent mode.
 * Hidden until asked for, so a kid looking at the screen does not see it.
 */
export function ParentCodeCard() {
  const queryClient = useQueryClient();
  const secret = useQuery({
    queryKey: ['parent-code'],
    queryFn: () => api.get<ParentCodeSecret>('/v1/family/parent-code'),
    staleTime: Infinity,
  });
  const [shown, setShown] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const { code, left } = useParentCode(shown ? secret.data?.secret : undefined);
  const rotate = useMutation({
    mutationFn: () => api.post<ParentCodeSecret>('/v1/family/parent-code/rotate'),
    onSuccess: (next) => {
      queryClient.setQueryData(['parent-code'], next);
      setConfirm(false);
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Parent code</CardTitle>
        <CardDescription>
          When a kid's device is offline, type this code on it to start parent mode. It changes every 30 seconds.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {secret.isError ? (
          <div className="flex flex-col items-start gap-3">
            <p role="alert" className="text-sm text-danger">
              {messageOf(secret.error)}
            </p>
            <Button variant="outline" size="sm" onClick={() => void secret.refetch()}>
              <RefreshCw />
              Try again
            </Button>
          </div>
        ) : !shown ? (
          <Button variant="outline" className="self-start" disabled={!secret.data} onClick={() => setShown(true)}>
            <Eye />
            Show code
          </Button>
        ) : (
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-4 rounded-2xl bg-surface-variant px-5 py-3">
              <p
                aria-live="polite"
                aria-label={code ? `Parent code ${code.split('').join(' ')}` : 'Working out the code'}
                className="font-mono text-3xl font-semibold tracking-widest tabular-nums"
              >
                {code ? spacedCode(code) : '··· ···'}
              </p>
              <CountdownRing left={left} />
            </div>
            <Button variant="ghost" size="sm" onClick={() => setShown(false)}>
              <EyeOff />
              Hide
            </Button>
          </div>
        )}
        <div className="border-t border-outline pt-4">
          <Button variant="link" size="sm" className="text-muted" disabled={!secret.data} onClick={() => setConfirm(true)}>
            <KeyRound />
            Make a new code…
          </Button>
        </div>
      </CardContent>

      <Dialog open={confirm} onOpenChange={(o) => !o && setConfirm(false)}>
        <DialogContent>
          <DialogTitle>Make a new parent code?</DialogTitle>
          <DialogDescription>
            Do this if a kid has seen how the code works, or a parent's phone was lost. The old codes stop working on
            each device the next time it is online.
          </DialogDescription>
          {rotate.error && (
            <p role="alert" className="text-sm text-danger">
              {messageOf(rotate.error)}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Button variant="outline" disabled={rotate.isPending} onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button disabled={rotate.isPending} onClick={() => rotate.mutate()}>
              {rotate.isPending && <Loader2 className="animate-spin" />}
              Make new code
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
```

### 5.5 `web/src/components/notifications-card.tsx`

```tsx
import type { NotificationKind, NotificationPref } from '@screentime/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { ApiError } from '@/lib/api';
import { api } from '@/lib/auth';
import { NOTIFICATION_TEXT } from '@/lib/settings';

function messageOf(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong. Try again.';
}

/**
 * docs/SPEC.md §13: which alerts this parent's phone gets. SOS and requests that wait for an answer are
 * always on. Each switch saves at once.
 */
export function NotificationsCard() {
  const queryClient = useQueryClient();
  const prefs = useQuery({
    queryKey: ['notification-prefs'],
    queryFn: () => api.get<NotificationPref[]>('/v1/me/notification-prefs'),
  });
  const save = useMutation({
    mutationFn: (change: { kind: NotificationKind; enabled: boolean }) =>
      api.put<NotificationPref[]>('/v1/me/notification-prefs', [change]),
    onSuccess: (result) => queryClient.setQueryData(['notification-prefs'], result),
  });

  // Always-on kinds first, then the server's order (the sort is stable).
  const sorted = [...(prefs.data ?? [])].sort((a, b) => Number(b.essential) - Number(a.essential));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
        <CardDescription>
          Alerts on your phone from the ScreenTime parent app. These are yours only. The Inbox always shows everything.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {prefs.isError && !prefs.data ? (
          <div className="flex flex-col items-start gap-3">
            <p role="alert" className="text-sm text-danger">
              {messageOf(prefs.error)}
            </p>
            <Button variant="outline" size="sm" onClick={() => void prefs.refetch()}>
              <RefreshCw />
              Try again
            </Button>
          </div>
        ) : !prefs.data ? (
          <div className="h-64 animate-pulse rounded-xl bg-surface-variant/50" aria-label="Loading" />
        ) : (
          <ul className="flex flex-col">
            {sorted.map((pref) => {
              const text = NOTIFICATION_TEXT[pref.kind] ?? { title: pref.kind, detail: '' };
              const pending = save.isPending && save.variables?.kind === pref.kind;
              const checked = pending ? (save.variables?.enabled ?? pref.enabled) : pref.enabled;
              const id = `notify-${pref.kind}`;
              return (
                <li key={pref.kind} className="flex items-center gap-4 border-t border-outline py-3 first:border-t-0 first:pt-0">
                  <div className="min-w-0 flex-1">
                    <label htmlFor={pref.essential ? undefined : id} className="font-medium">
                      {text.title}
                    </label>
                    <p className="text-sm text-muted">{text.detail}</p>
                  </div>
                  {pref.essential ? (
                    <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted">
                      <Lock className="size-3.5" />
                      Always on
                    </span>
                  ) : (
                    <Switch
                      id={id}
                      checked={checked}
                      disabled={pending}
                      onCheckedChange={(enabled) => save.mutate({ kind: pref.kind, enabled })}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {save.error && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {messageOf(save.error)}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
```

### 5.6 `web/src/components/presets-card.tsx`

Works like the contacts editor of CARD-024: edits stay in a draft until **Save messages**, and errors show after the first save.

```tsx
import type { MessagePreset } from '@screentime/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUp, Check, Loader2, MessageSquare, Plus, RefreshCw, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { api } from '@/lib/auth';
import { MAX_PRESETS, PRESET_MAX_LENGTH, presetErrors } from '@/lib/settings';

interface Row {
  key: string;
  text: string;
}

function messageOf(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong. Try again.';
}

function rowsOf(presets: MessagePreset[]): Row[] {
  return presets.map((p) => ({ key: p.id, text: p.text }));
}

function bodyOf(rows: Row[]) {
  return rows.map((r) => ({ text: r.text.trim() }));
}

/**
 * docs/SPEC.md §12 (Q29): messages a kid can send to Mum and Dad with one tap, from the kid UI and the block
 * screen. Kids can also type their own. The whole list is saved at once, in this order.
 */
export function PresetsCard() {
  const queryClient = useQueryClient();
  const presets = useQuery({
    queryKey: ['message-presets'],
    queryFn: () => api.get<MessagePreset[]>('/v1/family/message-presets'),
  });
  const [draft, setDraft] = useState<Row[] | null>(null);
  // Errors show after the first Save, not while typing.
  const [tried, setTried] = useState(false);
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: (rows: Row[]) => api.put<MessagePreset[]>('/v1/family/message-presets', { presets: bodyOf(rows) }),
    onSuccess: (result) => {
      queryClient.setQueryData(['message-presets'], result);
      setDraft(null);
      setTried(false);
      setSaved(true);
    },
  });

  if (!presets.data) {
    return presets.isError ? (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <p className="text-sm text-danger" role="alert">
            {messageOf(presets.error)}
          </p>
          <Button variant="outline" onClick={() => void presets.refetch()}>
            <RefreshCw />
            Try again
          </Button>
        </CardContent>
      </Card>
    ) : (
      <Card className="h-64 animate-pulse bg-surface-variant/50" aria-label="Loading" />
    );
  }

  const rows = draft ?? rowsOf(presets.data);
  const dirty = draft !== null && JSON.stringify(bodyOf(draft)) !== JSON.stringify(bodyOf(rowsOf(presets.data)));
  const errors = presetErrors(rows.map((r) => r.text));
  const invalid = errors.some(Boolean);
  const edit = (next: Row[]) => {
    setDraft(next);
    setSaved(false);
    save.reset();
  };
  const moveUp = (index: number) => {
    const next = [...rows];
    const [row] = next.splice(index, 1);
    if (row) next.splice(index - 1, 0, row);
    edit(next);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Messages kids can send</CardTitle>
        <CardDescription>
          Kids tap one of these to send it to every parent, even when their device is locked. They can also type their
          own.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {rows.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-xl bg-surface-variant/60 py-8 text-center">
            <MessageSquare className="size-6 text-muted" />
            <p className="text-sm text-muted">No ready-made messages. Kids can still type their own.</p>
          </div>
        )}
        {rows.map((row, i) => {
          const error = tried ? errors[i] : undefined;
          const length = row.text.trim().length;
          return (
            <div key={row.key} role="group" aria-label={`Message ${i + 1}`} className="flex items-start gap-1">
              <div className="min-w-0 flex-1">
                <Input
                  aria-label={`Message ${i + 1}`}
                  placeholder="Like: Can you call me?"
                  value={row.text}
                  maxLength={PRESET_MAX_LENGTH}
                  aria-invalid={error !== undefined || undefined}
                  onChange={(e) => edit(rows.map((r) => (r.key === row.key ? { ...r, text: e.target.value } : r)))}
                />
                {error ? (
                  <p className="mt-1 text-xs text-danger">{error}</p>
                ) : (
                  length > PRESET_MAX_LENGTH - 20 && (
                    <p className="mt-1 text-xs text-muted">
                      {length} of {PRESET_MAX_LENGTH} characters
                    </p>
                  )
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Move message ${i + 1} up`}
                className="size-10 sm:size-12"
                disabled={i === 0}
                onClick={() => moveUp(i)}
              >
                <ArrowUp />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove message ${i + 1}`}
                className="size-10 sm:size-12"
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
          disabled={rows.length >= MAX_PRESETS}
          onClick={() => edit([...rows, { key: crypto.randomUUID(), text: '' }])}
        >
          <Plus />
          {rows.length >= MAX_PRESETS ? `${MAX_PRESETS} messages at most` : 'Add a message'}
        </Button>

        <div className="mt-2 flex flex-wrap items-center justify-end gap-3 border-t border-outline pt-4">
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
            Save messages
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
```

### 5.7 `web/src/components/parents-card.tsx`

```tsx
import type { Parent } from '@screentime/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, MoreHorizontal, Pencil, Plus, RefreshCw, Trash2, TriangleAlert } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { KidAvatar } from '@/components/kid-avatar';
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
import { api, useAuth } from '@/lib/auth';
import { normalisePhone } from '@/lib/kid';

type Action = { kind: 'add' } | { kind: 'edit'; parent: Parent } | { kind: 'remove'; parent: Parent };

// Parents share one neutral colour; colours belong to kids.
const PARENT_COLOR = '#475569';

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

/** Add a parent (parent null) or change a parent's name and mobile. The email cannot change. */
function ParentForm({ parent, onDone }: { parent: Parent | null; onDone: (saved: Parent) => void }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState(parent?.email ?? '');
  const [name, setName] = useState(parent?.displayName ?? '');
  const [phone, setPhone] = useState(parent?.phoneE164 ?? '');
  const [tried, setTried] = useState(false);
  const phoneE164 = phone.trim() ? normalisePhone(phone) : null;
  const errors: { email?: string; name?: string; phone?: string } = {
    email: parent || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? undefined : 'Type an email address.',
    name: name.trim() ? undefined : 'Type a name, like Mum or Dad.',
    phone: phone.trim() && !phoneE164 ? 'Type a number like 0412 345 678 or +61412345678.' : undefined,
  };
  const save = useMutation({
    mutationFn: () =>
      parent
        ? api.patch<Parent>(`/v1/family/parents/${parent.id}`, { displayName: name.trim(), phoneE164 })
        : api.post<Parent>('/v1/family/parents', { email: email.trim(), displayName: name.trim(), phoneE164 }),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ['parents'] });
      onDone(saved);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (!errors.email && !errors.name && !errors.phone) save.mutate();
  };
  const shown = tried ? errors : {};

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      <DialogTitle>{parent ? `Edit ${parent.displayName}` : 'Add a parent'}</DialogTitle>
      {!parent && (
        <DialogDescription>
          They sign in on the web or the parent app with this email. No invitation is sent, so tell them.
        </DialogDescription>
      )}
      <div className="flex flex-col gap-2">
        <Label htmlFor="parent-email">Email</Label>
        <Input
          id="parent-email"
          type="email"
          autoComplete="off"
          value={email}
          disabled={parent !== null}
          aria-invalid={shown.email !== undefined || undefined}
          onChange={(e) => setEmail(e.target.value)}
        />
        {shown.email && <p className="text-xs text-danger">{shown.email}</p>}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="parent-name">Name the kids see</Label>
        <Input
          id="parent-name"
          placeholder="Mum, Dad, Nan…"
          maxLength={40}
          autoComplete="off"
          value={name}
          aria-invalid={shown.name !== undefined || undefined}
          onChange={(e) => setName(e.target.value)}
        />
        {shown.name && <p className="text-xs text-danger">{shown.name}</p>}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="parent-phone">Mobile (optional)</Label>
        <Input
          id="parent-phone"
          type="tel"
          inputMode="tel"
          autoComplete="off"
          placeholder="0412 345 678"
          value={phone}
          aria-invalid={shown.phone !== undefined || undefined}
          onChange={(e) => setPhone(e.target.value)}
        />
        {shown.phone ? (
          <p className="text-xs text-danger">{shown.phone}</p>
        ) : (
          <p className="text-xs text-muted">SOS texts go to this number, and the kids' phones can always call it.</p>
        )}
      </div>
      <ErrorText error={save.error} />
      <Button type="submit" disabled={save.isPending}>
        {save.isPending && <Loader2 className="animate-spin" />}
        {parent ? 'Save' : 'Add parent'}
      </Button>
    </form>
  );
}

function RemoveBody({ parent, onDone }: { parent: Parent; onDone: () => void }) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => api.delete(`/v1/family/parents/${parent.id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['parents'] });
      onDone();
    },
  });
  return (
    <>
      <DialogTitle>Remove {parent.displayName}?</DialogTitle>
      <DialogDescription>
        {parent.email} is signed out everywhere, stops getting alerts and SOS texts, and can no longer sign in.
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

/** docs/SPEC.md §9.2: the parents of the family. Any parent can add, edit or remove the others. */
export function ParentsCard() {
  const auth = useAuth();
  const myId = auth.status === 'signedIn' ? (auth.me.parent?.id ?? null) : null;
  const parents = useQuery({ queryKey: ['parents'], queryFn: () => api.get<Parent[]>('/v1/family/parents') });
  const [action, setAction] = useState<Action | null>(null);
  const close = () => setAction(null);

  return (
    <>
      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Parents</h2>
              <p className="text-sm text-muted">Every parent gets SOS alerts and can answer the kids' requests.</p>
            </div>
            <Button onClick={() => setAction({ kind: 'add' })}>
              <Plus />
              Add parent
            </Button>
          </div>
          {parents.isError && !parents.data ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <p className="text-sm text-danger" role="alert">
                {messageOf(parents.error)}
              </p>
              <Button variant="outline" onClick={() => void parents.refetch()}>
                <RefreshCw />
                Try again
              </Button>
            </div>
          ) : !parents.data ? (
            <div className="h-24 animate-pulse rounded-xl bg-surface-variant/50" aria-label="Loading" />
          ) : (
            <div>
              {parents.data.map((parent) => {
                const me = parent.id === myId;
                return (
                  <div key={parent.id} className="flex items-center gap-4 border-t border-outline py-4 last:pb-0">
                    <KidAvatar name={parent.displayName} color={PARENT_COLOR} className="size-11" />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 font-medium">
                        <span className="truncate">{parent.displayName}</span>
                        {me && (
                          <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                            You
                          </span>
                        )}
                      </p>
                      <p className="truncate text-sm text-muted">{parent.email}</p>
                      {parent.phoneE164 ? (
                        <p className="truncate text-sm text-muted tabular-nums">{parent.phoneE164}</p>
                      ) : (
                        <p className="flex items-center gap-1.5 text-xs font-medium text-warning">
                          <TriangleAlert className="size-3.5" />
                          No mobile, so no SOS texts
                        </p>
                      )}
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label={`More for ${parent.displayName}`}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem onSelect={() => setAction({ kind: 'edit', parent })}>
                          <Pencil />
                          Edit…
                        </DropdownMenuItem>
                        {!me && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem danger onSelect={() => setAction({ kind: 'remove', parent })}>
                              <Trash2 />
                              Remove parent…
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={action !== null} onOpenChange={(o) => !o && close()}>
        <DialogContent>
          {action?.kind === 'add' && <ParentForm parent={null} onDone={close} />}
          {action?.kind === 'edit' && (
            <ParentForm
              parent={action.parent}
              onDone={(saved) => {
                // The signed-in parent's own name and mobile also live in the sign-in.
                if (saved.id === myId) void api.refresh();
                close();
              }}
            />
          )}
          {action?.kind === 'remove' && <RemoveBody parent={action.parent} onDone={close} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
```

### 5.8 `web/src/components/family-card.tsx`

```tsx
import type { Family } from '@screentime/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { ApiError } from '@/lib/api';
import { api } from '@/lib/auth';
import { type FamilyDraft, familyErrors, timeZones, zoneLabel } from '@/lib/settings';

function messageOf(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong. Try again.';
}

function draftOf(family: Family): FamilyDraft {
  return { name: family.name, timezone: family.timezone, emergencyNumber: family.emergencyNumber };
}

/** Only the fields that changed, trimmed: PATCH /v1/family. */
function patchOf(draft: FamilyDraft, family: Family): Partial<FamilyDraft> {
  const patch: Partial<FamilyDraft> = {};
  if (draft.name.trim() !== family.name) patch.name = draft.name.trim();
  if (draft.timezone !== family.timezone) patch.timezone = draft.timezone;
  if (draft.emergencyNumber.trim() !== family.emergencyNumber) patch.emergencyNumber = draft.emergencyNumber.trim();
  return patch;
}

/** docs/SPEC.md §9.2: the family's name, time zone and emergency number. Devices get changes when they sync. */
export function FamilyCard() {
  const queryClient = useQueryClient();
  const family = useQuery({ queryKey: ['family'], queryFn: () => api.get<Family>('/v1/family') });
  const [draft, setDraft] = useState<FamilyDraft | null>(null);
  const [tried, setTried] = useState(false);
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: (patch: Partial<FamilyDraft>) => api.patch<Family>('/v1/family', patch),
    onSuccess: (result) => {
      queryClient.setQueryData(['family'], result);
      setDraft(null);
      setTried(false);
      setSaved(true);
      // The sign-in holds the family too (the time zone shapes every time on every page): fetch it again.
      void api.refresh().then(() => queryClient.invalidateQueries());
    },
  });
  const current = family.data?.timezone ?? '';
  const zones = useMemo(() => (current ? timeZones(current) : []), [current]);

  if (!family.data) {
    return family.isError ? (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <p className="text-sm text-danger" role="alert">
            {messageOf(family.error)}
          </p>
          <Button variant="outline" onClick={() => void family.refetch()}>
            <RefreshCw />
            Try again
          </Button>
        </CardContent>
      </Card>
    ) : (
      <Card className="h-64 animate-pulse bg-surface-variant/50" aria-label="Loading" />
    );
  }

  const value = draft ?? draftOf(family.data);
  const patch = patchOf(value, family.data);
  const dirty = Object.keys(patch).length > 0;
  const errors = tried ? familyErrors(value) : {};
  const edit = (change: Partial<FamilyDraft>) => {
    setDraft({ ...value, ...change });
    setSaved(false);
    save.reset();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Family</CardTitle>
        <CardDescription>Kids' devices pick up changes the next time they are online.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <Label htmlFor="family-name">Family name</Label>
          <Input
            id="family-name"
            maxLength={100}
            autoComplete="off"
            value={value.name}
            aria-invalid={errors.name !== undefined || undefined}
            onChange={(e) => edit({ name: e.target.value })}
          />
          {errors.name && <p className="text-xs text-danger">{errors.name}</p>}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="family-timezone">Time zone</Label>
          <Select id="family-timezone" value={value.timezone} onChange={(e) => edit({ timezone: e.target.value })}>
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zoneLabel(zone)}
              </option>
            ))}
          </Select>
          <p className="text-xs text-muted">Days start at midnight here, and bedtimes and wake-up times use it.</p>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="family-emergency">Emergency number</Label>
          <Input
            id="family-emergency"
            className="max-w-40"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            value={value.emergencyNumber}
            aria-invalid={errors.emergencyNumber !== undefined || undefined}
            onChange={(e) => edit({ emergencyNumber: e.target.value })}
          />
          {errors.emergencyNumber ? (
            <p className="text-xs text-danger">{errors.emergencyNumber}</p>
          ) : (
            <p className="text-xs text-muted">Kids' phones can always call it, even when locked. In Australia it is 000.</p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-outline pt-4">
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
              const found = familyErrors(value);
              if (!found.name && !found.emergencyNumber) save.mutate(patch);
            }}
          >
            {save.isPending && <Loader2 className="animate-spin" />}
            Save family
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
```

### 5.9 `web/src/pages/settings.tsx`

```tsx
import { FamilyCard } from '@/components/family-card';
import { NotificationsCard } from '@/components/notifications-card';
import { PageHeader } from '@/components/page-header';
import { ParentCodeCard } from '@/components/parent-code-card';
import { ParentsCard } from '@/components/parents-card';
import { PresetsCard } from '@/components/presets-card';

/**
 * docs/SPEC.md §16.5 Settings: one column of cards, most used first. The parent code is at the top because
 * a parent opens it in a hurry, standing next to an offline device.
 */
export function SettingsPage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader title="Settings" />
      <ParentCodeCard />
      <NotificationsCard />
      <PresetsCard />
      <ParentsCard />
      <FamilyCard />
    </div>
  );
}
```

### 5.10 `web/src/router.tsx`

The only change: `/settings` shows `SettingsPage` instead of the placeholder. `ComingSoon` is still imported, because Admin still uses it.

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
import { SettingsPage } from '@/pages/settings';
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
const settingsRoute = createRoute({ getParentRoute: () => appRoute, path: '/settings', component: SettingsPage });
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

### 5.11 `web/test/totp.test.ts`

```typescript
import { describe, expect, it } from 'vitest';
import { base32Decode, secondsLeft, totp } from '../src/lib/totp';

// RFC 6238 appendix B: the SHA-1 secret is the ASCII text "12345678901234567890".
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('base32Decode', () => {
  it('decodes RFC 4648 base32, ignoring case, spaces and padding', () => {
    expect(new TextDecoder().decode(base32Decode(RFC_SECRET))).toBe('12345678901234567890');
    expect(new TextDecoder().decode(base32Decode('mzxw6==='))).toBe('foo');
    expect(new TextDecoder().decode(base32Decode('MZXW 6YTB OI'))).toBe('foobar');
    expect(() => base32Decode('MZXW1')).toThrow();
  });
});

describe('totp', () => {
  it('matches the RFC 6238 SHA-1 test vectors', async () => {
    expect(await totp(RFC_SECRET, 59_000, 8)).toBe('94287082');
    expect(await totp(RFC_SECRET, 1_111_111_109_000, 8)).toBe('07081804');
    expect(await totp(RFC_SECRET, 1_234_567_890_000, 8)).toBe('89005924');
    expect(await totp(RFC_SECRET, 20_000_000_000_000, 8)).toBe('65353130');
  });

  it('gives 6 digits by default, the same for the whole 30-second step', async () => {
    expect(await totp(RFC_SECRET, 1_111_111_109_000)).toBe('081804');
    expect(await totp(RFC_SECRET, 1_111_111_080_000)).toBe('081804');
    expect(await totp(RFC_SECRET, 1_111_111_110_000)).not.toBe('081804');
  });
});

describe('secondsLeft', () => {
  it('counts from 30 down to 1 in each step', () => {
    expect(secondsLeft(0)).toBe(30);
    expect(secondsLeft(999)).toBe(30);
    expect(secondsLeft(1_000)).toBe(29);
    expect(secondsLeft(29_999)).toBe(1);
    expect(secondsLeft(30_000)).toBe(30);
  });
});
```

### 5.12 `web/test/settings.test.ts`

This test imports `NotificationKind` from `@screentime/schemas` as a value, to check every kind has words. That is fine in a test; code in `web/src` only imports types from that package.

```typescript
import { NotificationKind } from '@screentime/schemas';
import { describe, expect, it } from 'vitest';
import { NOTIFICATION_TEXT, familyErrors, presetErrors, timeZones, zoneLabel } from '../src/lib/settings';

describe('NOTIFICATION_TEXT', () => {
  it('has a title and a detail for every notification kind', () => {
    for (const kind of NotificationKind.options) {
      expect(NOTIFICATION_TEXT[kind].title).not.toBe('');
      expect(NOTIFICATION_TEXT[kind].detail).not.toBe('');
    }
  });
});

describe('presetErrors', () => {
  it('flags empty and too long messages only', () => {
    expect(presetErrors(['Can you call me?', '   ', 'x'.repeat(160), `  ${'x'.repeat(161)}  `])).toEqual([
      undefined,
      'Type a message, or remove it.',
      undefined,
      'Keep it to 160 characters.',
    ]);
  });
});

describe('familyErrors', () => {
  it('needs a name and a 2 to 6 digit emergency number', () => {
    expect(familyErrors({ name: 'Gallagher', timezone: 'Australia/Sydney', emergencyNumber: '000' })).toEqual({
      name: undefined,
      emergencyNumber: undefined,
    });
    expect(familyErrors({ name: ' ', timezone: 'Australia/Sydney', emergencyNumber: '0' })).toEqual({
      name: 'Type a family name.',
      emergencyNumber: 'Use 2 to 6 digits, like 000.',
    });
    expect(familyErrors({ name: 'G', timezone: 'UTC', emergencyNumber: '1234567' }).emergencyNumber).toBeDefined();
    expect(familyErrors({ name: 'G', timezone: 'UTC', emergencyNumber: '11 2' }).emergencyNumber).toBeDefined();
  });
});

describe('timeZones', () => {
  it('lists zones sorted, with the current one even when the runtime lacks it', () => {
    const zones = timeZones('Australia/Sydney');
    expect(zones).toContain('Australia/Sydney');
    expect(zones).toEqual([...zones].sort());
    expect(timeZones('Mars/Olympus_Mons')).toContain('Mars/Olympus_Mons');
  });

  it('reads well', () => {
    expect(zoneLabel('America/New_York')).toBe('America / New York');
  });
});
```

## 6. Detailed spec

### 6.1 Page

- `Settings` heading, then one column of cards, at most 768 px wide and centred: Parent code, Notifications, Messages kids can send, Parents, Family. The parent code is first because a parent opens it in a hurry, standing next to an offline device.
- On a 360 px wide phone nothing scrolls sideways.

### 6.2 Parent code

- `Parent code`, `When a kid's device is offline, type this code on it to start parent mode. It changes every 30 seconds.`
- At first only an outlined `Show code` button (with an eye). After it: a grey rounded box with the code in a large monospaced font as `864 946`, and a ring on its right that empties over 30 seconds with the seconds left in the middle (teal, amber for the last 5 seconds). Then a `Hide` button.
- The code is the one for the current 30-second step, from the secret the server sent. It changes exactly when the ring restarts at 30. While the first code is being worked out the box shows `··· ···`.
- Under a line: a small grey link-style button with a key, `Make a new code…`. It opens `Make a new parent code?`, `Do this if a kid has seen how the code works, or a parent's phone was lost. The old codes stop working on each device the next time it is online.`, `Cancel` and `Make new code`. After it the code shown is from the new secret.

### 6.3 Notifications

- `Notifications`, `Alerts on your phone from the ScreenTime parent app. These are yours only. The Inbox always shows everything.`
- One row per kind, the essential ones (SOS, Parent mode requests, Requests for more time) first, then the others in the server's order. Each row: the title in medium weight, the detail in grey under it, and on the right a switch, or `Always on` with a small lock for an essential kind.
- A switch saves at once (`PUT` with just that kind). While saving it shows the new position and cannot be pressed. An error shows in red under the list.

### 6.4 Messages kids can send

- `Messages kids can send`, `Kids tap one of these to send it to every parent, even when their device is locked. They can also type their own.`
- One text box per message (160 characters at most; past 140 a grey `152 of 160 characters` shows under it), then an up arrow (disabled for the first) and an X. `Add a message` adds an empty one, up to 10 (`10 messages at most`).
- Under a line: `Unsaved changes` / `Saved.` / the server's error on the left, `Undo changes` while something changed, and `Save messages`. An empty message shows `Type a message, or remove it.` after Save, and nothing is sent.
- No messages: a grey box with a speech bubble and `No ready-made messages. Kids can still type their own.`

### 6.5 Parents

- `Parents`, `Every parent gets SOS alerts and can answer the kids' requests.`, and `Add parent` on the right.
- One row per parent: a slate circle with the first letter, the name with a teal `You` chip for the signed-in parent, the email, and the mobile, or in amber `No mobile, so no SOS texts` with a warning triangle. A `…` menu on the right: `Edit…`, and for every parent except you a separator and a red `Remove parent…`.
- `Add a parent` dialog: `They sign in on the web or the parent app with this email. No invitation is sent, so tell them.`, `Email`, `Name the kids see` (placeholder `Mum, Dad, Nan…`), `Mobile (optional)` with `SOS texts go to this number, and the kids' phones can always call it.` under it, and `Add parent`. An Australian `0412 345 678` is saved as `+61412345678` (the same `normalisePhone` as the contacts). Errors show under each field after the first try; a taken email shows the server's message.
- `Edit <name>`: the same form with the email greyed out, and `Save`. Editing yourself refreshes the sign-in.
- `Remove <name>?`, `<email> is signed out everywhere, stops getting alerts and SOS texts, and can no longer sign in.`, `Cancel` and a red `Remove`.

### 6.6 Family

- `Family`, `Kids' devices pick up changes the next time they are online.`
- `Family name`; `Time zone` (a native select of every zone the browser knows, shown as `Australia / Sydney`) with `Days start at midnight here, and bedtimes and wake-up times use it.`; `Emergency number` (a narrow box) with `Kids' phones can always call it, even when locked. In Australia it is 000.`
- Under a line the same save row as 6.4 with `Save family`. Only the changed fields are sent. After a save the sign-in is refreshed and every page's data is fetched again.

## 7. Steps

All commands in PowerShell from `C:\Users\james\OpenCode\Testing\ScreenTime` unless stated otherwise.

1. Start from the latest `main` and create the branch:
   ```powershell
   git checkout main
   git pull origin main
   git checkout -b bob/card-025b-settings
   pnpm install --frozen-lockfile
   ```
   After the pull, `docs/cards/CARD-025b-settings.md` and `web/src/pages/inbox.tsx` (CARD-025) must exist. If one is missing, run `git pull origin main` again, and if it is still missing, stop and ask James.
2. Create 5.1 to 5.9 and replace 5.10. Run `pnpm build` and `pnpm typecheck`. Commit: `CARD-025b: add the Settings page`.
3. Create 5.11 and 5.12. Run `pnpm --filter @screentime/web test`. Commit: `CARD-025b: add Settings tests`.
4. Run the acceptance checks in section 8.
5. Push and open the PR (section 10).
6. Wait for both CI checks to finish (`gh pr checks <number> --watch`).
7. Send James the handback report (section 12).

## 8. Acceptance criteria

Never put a real password, JWT secret, SMTP key, Firebase key, FCM token or device token in the PR or the handback.

- [ ] `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm typecheck` and `pnpm test` pass, and `git status --short pnpm-lock.yaml` is empty. `pnpm build` ends the web part with `✓ built in` (the 500 kB chunk warning is expected). Without `TEST_DATABASE_URL`:
  - `packages/schemas`: `Tests  36 passed (36)`.
  - `packages/engine`: `Tests  27 passed (27)`.
  - `web`: `test/format.test.ts (3 tests)`, `test/api.test.ts (6 tests)`, `test/today.test.ts (9 tests)`, `test/kid.test.ts (10 tests)`, `test/inbox.test.ts (8 tests)`, `test/totp.test.ts (4 tests)`, `test/settings.test.ts (5 tests)`, `Tests  45 passed (45)`.
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
  (curl.exe -s http://localhost:5173/src/pages/settings.tsx | Out-String).Length -gt 1000
  ```
  Both print `True`. Stop `pnpm dev:web` with Ctrl+C. Claude checks the pages in a browser with test data after the PR is open; you do not need to sign in.
- [ ] `git status` does **not** list `deploy/.env` or anything in `web/dist/`.
- [ ] Both GitHub Actions checks are green on the PR: **TypeScript / typecheck and test** and **TypeScript / docker compose smoke test**. Wait for them (`gh pr checks <number> --watch`) before you write the handback.
- [ ] Only the expected files changed. `git diff --name-only main...HEAD` lists exactly these 12 files (in any order):
  ```
  web/src/components/family-card.tsx
  web/src/components/notifications-card.tsx
  web/src/components/parent-code-card.tsx
  web/src/components/parents-card.tsx
  web/src/components/presets-card.tsx
  web/src/components/ui/switch.tsx
  web/src/lib/settings.ts
  web/src/lib/totp.ts
  web/src/pages/settings.tsx
  web/src/router.tsx
  web/test/settings.test.ts
  web/test/totp.test.ts
  ```

## 9. Tests

| File | What it asserts |
|---|---|
| `web/test/totp.test.ts` | `base32Decode` turns the RFC 6238 secret back into `12345678901234567890`, ignores case, spaces and `=`, and throws on a character that is not base32. `totp` gives the four official RFC 6238 SHA-1 codes (8 digits) at 59 s, 1111111109 s, 1234567890 s and 20000000000 s; with 6 digits it gives the same code for the whole 30-second step and a new one in the next. `secondsLeft` counts 30 down to 1. |
| `web/test/settings.test.ts` | Every notification kind has a title and a detail. `presetErrors` flags an empty message and one over 160 characters (after trimming), and accepts exactly 160. `familyErrors` needs a name and a 2 to 6 digit emergency number. `timeZones` is sorted and always has the current zone, even an unknown one. `zoneLabel`. |

## 10. Git and pull request

1. Start from the latest `main` (step 1 above).
2. Commit in small logical commits (steps 2 and 3). Message format: `CARD-025b: <what changed>`.
3. Before pushing, run every acceptance command again and make sure all pass.
4. Push: `git push -u origin bob/card-025b-settings`
5. Open a PR into `main` titled `CARD-025b: Settings`. Write the body to `C:\Users\james\OpenCode\Testing\temp\pr-body.md` (the shared temp folder outside the repo; create it first with `New-Item -ItemType Directory -Force C:\Users\james\OpenCode\Testing\temp | Out-Null`) and run `gh pr create --base main --head bob/card-025b-settings --title "CARD-025b: Settings" --body-file C:\Users\james\OpenCode\Testing\temp\pr-body.md`. Body:
   ```markdown
   ## Card
   docs/cards/CARD-025b-settings.md

   ## What I did
   - ...

   ## Acceptance criteria
   - [x] install, build, typecheck, test — output: `...`
   - [x] contract unchanged
   - [x] database tests — output: `Tests  212 passed (212)`
   - [x] dev server serves the app — output: `True`, `True`
   - [x] deploy/.env and web/dist not tracked
   - [x] both CI checks green
   - [x] only expected files changed — output: 12 files

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

- **TypeScript says a `Uint8Array` is not assignable to `BufferSource`** in `totp.ts`: you dropped the `Uint8Array<ArrayBuffer>` return type or the `new ArrayBuffer(...)` in `base32Decode`. Copy 5.1 again exactly.
- **A TOTP test fails**: the expected codes are the official ones from RFC 6238 appendix B. Do not change them; report the exact output.
- **Special characters**: copy `…`, `·` and `§` exactly. Check with `Select-String -Path web\src\components\parents-card.tsx -Pattern '…'` (it should find 3 lines).
- **`curl` in PowerShell**: write `curl.exe`, not `curl`, and keep the `| Out-String` of section 8.
- **Temporary files** (the PR body, any helper script) go in `C:\Users\james\OpenCode\Testing\temp\` (AGENTS.md rule 8), never in `$env:TEMP`. List them under "Outside the repo".
- **The live.test.ts `afterAll` hook timed out** in the database tests: this happened once in CARD-024 on your PC and not on the re-run. If it happens, run the database tests once more and report both outputs under "Commands run". Do not change the test.
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
Claude, here is Bob's handback for CARD-025b. Please review and merge if it is good.

CARD: CARD-025b Settings
PR: <full PR URL>
Branch: bob/card-025b-settings
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
