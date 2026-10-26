# CARD-026: Super admin pages

| Field | Value |
|---|---|
| Card | CARD-026 |
| Title | Super admin pages |
| Size | S |
| Depends on | CARD-025b (merged to `main`) |
| Spec sections | docs/SPEC.md §6.2, §16.5 |
| Repository | https://github.com/jamesgallagher/ScreenTime |
| Local folder | `C:\Users\james\OpenCode\Testing\ScreenTime` |
| Base branch | `main` |
| Work branch | `bob/card-026-admin` |
| PR title | `CARD-026: Super admin pages` |

## 1. Project context

Screen Time is a self-hosted parental screen-time limiter for one family. Kid devices (Android phone/tablet, Windows 11 PCs) enforce daily time limits locally; a TypeScript server on Docker holds the shared record; parents use a web app and an Android parent app. The whole system lives in one monorepo. The full specification is `docs/SPEC.md`; the order of work is `docs/BUILD-PLAN.md`. Repository rules for coding agents are in `AGENTS.md` at the repo root: read it first. Rule 8 there says that every temporary file goes in `C:\Users\james\OpenCode\Testing\temp\`.

The parent web app is in `web/` (package `@screentime/web`): React 19, Vite, TanStack Router and Query, Tailwind CSS v4 with the design tokens of SPEC §16.1, shadcn/ui-style components in `web/src/components/ui`, and the API client `api` in `web/src/lib/auth.tsx`, which throws `ApiError` with the server's message. CARD-022 to CARD-025b built every parent page. Imports inside `web/src` use the `@/` alias and have no file extension.

The **super admin** is whoever signs in with the email in the server's `SUPER_ADMIN_EMAIL` setting (SPEC §6.2). They manage the families on the server. James is the super admin. Until now **Admin** was a "Coming soon" placeholder. This card builds it on APIs that already exist (CARD-012):

- **Families** list (`GET /v1/admin/families`): one row per family with its time zone, number of parents and start date, and a red `Disabled` chip for a disabled family.
- **New family** (`POST /v1/admin/families`): one dialog for the family (name, time zone, emergency number) and its first parent (email, name, optional mobile). When it is done, it says the parent can sign in now.
- Each enabled family has a `…` menu with **Add parent…** (`POST /v1/admin/families/{id}/parents`) and **Disable family…** (`POST /v1/admin/families/{id}/disable`, after a confirm step). The server has no way to enable a family again, so a disabled family has no menu.

The card also makes two small fixes:

- A super admin with no family now goes straight from sign-in to `/admin`. Before, the app went to `/` first and asked the server for Today, which answered 403.
- `web/src/pages/coming-soon.tsx` is deleted, because no page uses it any more.

## 2. Goal

The super admin signs in at http://localhost:5173, lands on **Families**, creates a family with its first parent, adds a parent to a family and disables a family. The pure logic is covered by Vitest tests.

## 3. Out of scope

Do **not** do any of these in this card:

- No server change, no change to `packages/schemas`, and the contract stays the same. No "enable family" button: the server has no endpoint for it.
- No new npm packages and no lockfile change. `pnpm-lock.yaml`, `pnpm-workspace.yaml` and every `package.json` stay as they are on `main`.
- No list of a family's parents or kids for the super admin, and no editing a family's settings from Admin: parents do that in their own Settings.
- Do not run the shadcn CLI. Do not change any file that is not listed in section 5.
- Never commit `deploy/.env`, `web/dist/`, a real JWT secret, an SMTP key, a Firebase key, an FCM token, a device token or a parent-code secret.

## 4. Tech and versions

Unchanged from `main`: Node 24, pnpm 11, TypeScript ^5.9, Vitest ^3.2, React ^19.3.1, Vite ^7.3.7, @tanstack/react-query ^5.104.5, @tanstack/react-router ^1.170.46, Tailwind CSS ^4.3.3, radix-ui ^1.8.1, lucide-react ^1.61.0. Nothing new to install.

`pnpm build` still prints the Vite warning `(!) Some chunks are larger than 500 kB after minification`, as in CARD-025b. That is expected.

Docker Desktop must be running for the server's database tests (check: `docker version` prints a `Server:` section).

## 5. Files

Create, change or delete exactly these files. Paths are relative to the repo root. Copy every code block exactly, character for character, blank lines included. Do not add or remove blank lines: in CARD-025b one extra blank line was the only difference from the card. This card is UTF-8; if you see `Â` or `â€` anywhere, you are reading it with the wrong encoding: open it as UTF-8, and do not report it as a card error. Some strings use characters that look like plain ones but are not: `…` (one character, U+2026, not three dots) at the end of menu items and a placeholder, `·` (U+00B7) between facts, and `§` (U+00A7) in comments. Copy them exactly.

| File | Action |
|---|---|
| `web/src/lib/admin.ts` | create (5.1) |
| `web/src/components/new-family-dialog.tsx` | create (5.2) |
| `web/src/pages/admin.tsx` | create (5.3) |
| `web/src/pages/sign-in.tsx` | replace (5.4) |
| `web/src/router.tsx` | replace (5.5) |
| `web/src/pages/coming-soon.tsx` | delete (5.6) |
| `web/test/admin.test.ts` | create (5.7) |

That is 7 files: 6 written and 1 deleted.

### 5.1 `web/src/lib/admin.ts`

The words under each family, the browser's time zone for a new family, and the checks and request body for **New family**.

```typescript
import type { AdminFamily } from '@screentime/schemas';
import { normalisePhone } from '@/lib/kid';
import { zoneLabel } from '@/lib/settings';

/** "Australia / Sydney · 2 parents · Since 26 Oct 2026", the date in the family's own time zone. */
export function familyFacts(family: AdminFamily): string {
  const since = new Intl.DateTimeFormat('en-AU', {
    timeZone: family.timezone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(family.createdAt));
  const parents = family.parentCount === 1 ? '1 parent' : `${family.parentCount} parents`;
  return [zoneLabel(family.timezone), parents, `Since ${since}`].join(' · ');
}

/** The browser's own time zone, for a new family; Sydney when the browser does not say. */
export function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Australia/Sydney';
  } catch {
    return 'Australia/Sydney';
  }
}

export interface NewFamilyDraft {
  name: string;
  timezone: string;
  emergencyNumber: string;
  email: string;
  displayName: string;
  phone: string;
}

export type NewFamilyErrors = Partial<Record<'name' | 'emergencyNumber' | 'email' | 'displayName' | 'phone', string>>;

/** The checks the server makes (packages/schemas family.ts AdminFamilyCreate), in plain words. */
export function newFamilyErrors(draft: NewFamilyDraft): NewFamilyErrors {
  const errors: NewFamilyErrors = {};
  if (!draft.name.trim()) errors.name = 'Type a family name.';
  if (!/^[0-9]{2,6}$/.test(draft.emergencyNumber.trim())) errors.emergencyNumber = 'Use 2 to 6 digits, like 000.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())) errors.email = 'Type an email address.';
  if (!draft.displayName.trim()) errors.displayName = 'Type a name, like Mum or Dad.';
  if (draft.phone.trim() && !normalisePhone(draft.phone)) errors.phone = 'Type a number like 0412 345 678 or +61412345678.';
  return errors;
}

/** Body of POST /v1/admin/families. */
export function newFamilyBody(draft: NewFamilyDraft) {
  return {
    name: draft.name.trim(),
    timezone: draft.timezone,
    emergencyNumber: draft.emergencyNumber.trim(),
    firstParent: {
      email: draft.email.trim(),
      displayName: draft.displayName.trim(),
      phoneE164: draft.phone.trim() ? normalisePhone(draft.phone) : null,
    },
  };
}
```

### 5.2 `web/src/components/new-family-dialog.tsx`

```tsx
import type { AdminFamilyCreated } from '@screentime/schemas';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, Loader2 } from 'lucide-react';
import { type FormEvent, type ReactNode, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { browserZone, type NewFamilyDraft, newFamilyBody, newFamilyErrors } from '@/lib/admin';
import { ApiError } from '@/lib/api';
import { api } from '@/lib/auth';
import { timeZones, zoneLabel } from '@/lib/settings';

function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? <p className="text-xs text-danger">{error}</p> : hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

/** The dialog's body: mounted fresh each time it opens. */
function NewFamilyForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<NewFamilyDraft>(() => ({
    name: '',
    timezone: browserZone(),
    emergencyNumber: '000',
    email: '',
    displayName: '',
    phone: '',
  }));
  const [tried, setTried] = useState(false);
  const zones = useMemo(() => timeZones(draft.timezone), [draft.timezone]);
  const create = useMutation({
    mutationFn: () => api.post<AdminFamilyCreated>('/v1/admin/families', newFamilyBody(draft)),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin', 'families'] }),
  });
  const errors = tried ? newFamilyErrors(draft) : {};
  const set = (change: Partial<NewFamilyDraft>) => setDraft({ ...draft, ...change });

  if (create.data) {
    const { family, parent } = create.data;
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <CircleCheck className="size-12 text-primary" />
        <DialogTitle>{family.name} is ready</DialogTitle>
        <DialogDescription>
          {parent.displayName} can sign in now with {parent.email}. No email is sent, so tell them. They add the kids and
          devices themselves.
        </DialogDescription>
        <Button className="w-full" onClick={onDone}>
          Done
        </Button>
      </div>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (Object.keys(newFamilyErrors(draft)).length === 0) create.mutate();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      <DialogTitle>New family</DialogTitle>
      <DialogDescription>The family starts with the usual messages for kids and its own parent code.</DialogDescription>
      <Field id="new-family-name" label="Family name" error={errors.name}>
        <Input
          id="new-family-name"
          placeholder="Smith family"
          maxLength={100}
          autoComplete="off"
          value={draft.name}
          aria-invalid={errors.name !== undefined || undefined}
          onChange={(e) => set({ name: e.target.value })}
        />
      </Field>
      <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_8rem]">
        <Field id="new-family-timezone" label="Time zone">
          <Select id="new-family-timezone" value={draft.timezone} onChange={(e) => set({ timezone: e.target.value })}>
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zoneLabel(zone)}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="new-family-emergency" label="Emergency number" error={errors.emergencyNumber}>
          <Input
            id="new-family-emergency"
            inputMode="numeric"
            maxLength={6}
            autoComplete="off"
            value={draft.emergencyNumber}
            aria-invalid={errors.emergencyNumber !== undefined || undefined}
            onChange={(e) => set({ emergencyNumber: e.target.value })}
          />
        </Field>
      </div>
      <fieldset className="flex flex-col gap-5 border-t border-outline pt-5">
        <legend className="sr-only">First parent</legend>
        <p className="text-sm font-semibold">First parent</p>
        <Field id="new-family-email" label="Email" error={errors.email} hint="They sign in with this email.">
          <Input
            id="new-family-email"
            type="email"
            autoComplete="off"
            value={draft.email}
            aria-invalid={errors.email !== undefined || undefined}
            onChange={(e) => set({ email: e.target.value })}
          />
        </Field>
        <Field id="new-family-parent" label="Name the kids see" error={errors.displayName}>
          <Input
            id="new-family-parent"
            placeholder="Mum, Dad, Nan…"
            maxLength={40}
            autoComplete="off"
            value={draft.displayName}
            aria-invalid={errors.displayName !== undefined || undefined}
            onChange={(e) => set({ displayName: e.target.value })}
          />
        </Field>
        <Field id="new-family-phone" label="Mobile (optional)" error={errors.phone} hint="SOS texts go to this number.">
          <Input
            id="new-family-phone"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            placeholder="0412 345 678"
            value={draft.phone}
            aria-invalid={errors.phone !== undefined || undefined}
            onChange={(e) => set({ phone: e.target.value })}
          />
        </Field>
      </fieldset>
      {create.error && (
        <p role="alert" className="text-sm text-danger">
          {create.error instanceof ApiError ? create.error.message : 'Something went wrong. Try again.'}
        </p>
      )}
      <Button type="submit" disabled={create.isPending}>
        {create.isPending && <Loader2 className="animate-spin" />}
        Create family
      </Button>
    </form>
  );
}

/** docs/SPEC.md §6.2: a super admin creates a family together with its first parent. */
export function NewFamilyDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>{open && <NewFamilyForm onDone={onClose} />}</DialogContent>
    </Dialog>
  );
}
```

### 5.3 `web/src/pages/admin.tsx`

```tsx
import type { AdminFamily, Parent } from '@screentime/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Home, Loader2, MoreHorizontal, Plus, RefreshCw, UserPlus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { NewFamilyDialog } from '@/components/new-family-dialog';
import { PageHeader } from '@/components/page-header';
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
import { familyFacts } from '@/lib/admin';
import { ApiError } from '@/lib/api';
import { api } from '@/lib/auth';
import { normalisePhone } from '@/lib/kid';
import { cn } from '@/lib/utils';

type Action = { kind: 'addParent'; family: AdminFamily } | { kind: 'disable'; family: AdminFamily };

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

/** Add a parent to any family (POST /v1/admin/families/{id}/parents). */
function AddParentBody({ family, onDone }: { family: AdminFamily; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [tried, setTried] = useState(false);
  const phoneE164 = phone.trim() ? normalisePhone(phone) : null;
  const errors: { email?: string; name?: string; phone?: string } = {
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? undefined : 'Type an email address.',
    name: name.trim() ? undefined : 'Type a name, like Mum or Dad.',
    phone: phone.trim() && !phoneE164 ? 'Type a number like 0412 345 678 or +61412345678.' : undefined,
  };
  const add = useMutation({
    mutationFn: () =>
      api.post<Parent>(`/v1/admin/families/${family.id}/parents`, {
        email: email.trim(),
        displayName: name.trim(),
        phoneE164,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'families'] });
      onDone();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (!errors.email && !errors.name && !errors.phone) add.mutate();
  };
  const shown = tried ? errors : {};

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      <DialogTitle>Add a parent to {family.name}</DialogTitle>
      <DialogDescription>They sign in with this email. No email is sent, so tell them.</DialogDescription>
      <div className="flex flex-col gap-2">
        <Label htmlFor="admin-parent-email">Email</Label>
        <Input
          id="admin-parent-email"
          type="email"
          autoComplete="off"
          value={email}
          aria-invalid={shown.email !== undefined || undefined}
          onChange={(e) => setEmail(e.target.value)}
        />
        {shown.email && <p className="text-xs text-danger">{shown.email}</p>}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="admin-parent-name">Name the kids see</Label>
        <Input
          id="admin-parent-name"
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
        <Label htmlFor="admin-parent-phone">Mobile (optional)</Label>
        <Input
          id="admin-parent-phone"
          type="tel"
          inputMode="tel"
          autoComplete="off"
          placeholder="0412 345 678"
          value={phone}
          aria-invalid={shown.phone !== undefined || undefined}
          onChange={(e) => setPhone(e.target.value)}
        />
        {shown.phone && <p className="text-xs text-danger">{shown.phone}</p>}
      </div>
      <ErrorText error={add.error} />
      <Button type="submit" disabled={add.isPending}>
        {add.isPending && <Loader2 className="animate-spin" />}
        Add parent
      </Button>
    </form>
  );
}

function DisableBody({ family, onDone }: { family: AdminFamily; onDone: () => void }) {
  const queryClient = useQueryClient();
  const disable = useMutation({
    mutationFn: () => api.post(`/v1/admin/families/${family.id}/disable`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'families'] });
      onDone();
    },
  });
  return (
    <>
      <DialogTitle>Disable {family.name}?</DialogTitle>
      <DialogDescription>
        Its parents are signed out at once and can no longer sign in. The app has no way to turn a family back on.
      </DialogDescription>
      <ErrorText error={disable.error} />
      <div className="grid grid-cols-2 gap-3">
        <Button variant="outline" disabled={disable.isPending} onClick={onDone}>
          Cancel
        </Button>
        <Button variant="danger" disabled={disable.isPending} onClick={() => disable.mutate()}>
          {disable.isPending ? <Loader2 className="animate-spin" /> : <Ban />}
          Disable
        </Button>
      </div>
    </>
  );
}

function FamilyRow({ family, onAction }: { family: AdminFamily; onAction: (action: Action) => void }) {
  const disabled = family.disabledAt !== null;
  return (
    <div className="flex items-center gap-4 border-t border-outline py-4 first:border-t-0 first:pt-0 last:pb-0">
      <span
        className={cn(
          'flex size-11 shrink-0 items-center justify-center rounded-full',
          disabled ? 'bg-surface-variant text-muted' : 'bg-primary/10 text-primary',
        )}
      >
        <Home className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 font-medium">
          <span className={cn('truncate', disabled && 'text-muted')}>{family.name}</span>
          {disabled && (
            <span className="shrink-0 rounded-full bg-danger/10 px-2.5 py-0.5 text-xs font-medium text-danger">
              Disabled
            </span>
          )}
        </p>
        <p className="text-sm text-muted">{familyFacts(family)}</p>
      </div>
      {!disabled && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`More for ${family.name}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={() => onAction({ kind: 'addParent', family })}>
              <UserPlus />
              Add parent…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem danger onSelect={() => onAction({ kind: 'disable', family })}>
              <Ban />
              Disable family…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

/** docs/SPEC.md §6.2 and §16.5 Admin: every family on this server, New family, add a parent, disable. */
export function AdminPage() {
  const families = useQuery({
    queryKey: ['admin', 'families'],
    queryFn: () => api.get<AdminFamily[]>('/v1/admin/families'),
  });
  const [creating, setCreating] = useState(false);
  const [action, setAction] = useState<Action | null>(null);
  const close = () => setAction(null);

  return (
    <>
      <PageHeader
        title="Families"
        description="Every family on this server. Only you, the super admin, see this page."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus />
            New family
          </Button>
        }
      />
      <Card>
        <CardContent>
          {families.isError && !families.data ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <p className="text-sm text-danger" role="alert">
                {messageOf(families.error)}
              </p>
              <Button variant="outline" onClick={() => void families.refetch()}>
                <RefreshCw />
                Try again
              </Button>
            </div>
          ) : !families.data ? (
            <div className="h-24 animate-pulse rounded-xl bg-surface-variant/50" aria-label="Loading" />
          ) : families.data.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-xl bg-surface-variant/60 py-10 text-center">
              <Home className="size-6 text-muted" />
              <p className="font-medium">No families yet</p>
              <p className="text-sm text-muted">Create the first one with New family.</p>
            </div>
          ) : (
            <div>
              {families.data.map((family) => (
                <FamilyRow key={family.id} family={family} onAction={setAction} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <NewFamilyDialog open={creating} onClose={() => setCreating(false)} />
      <Dialog open={action !== null} onOpenChange={(o) => !o && close()}>
        <DialogContent>
          {action?.kind === 'addParent' && <AddParentBody family={action.family} onDone={close} />}
          {action?.kind === 'disable' && <DisableBody family={action.family} onDone={close} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
```

### 5.4 `web/src/pages/sign-in.tsx`

The only change from `main` is the `Navigate` near the top of `SignInPage`, with its new comment line above it.

```tsx
import { Navigate } from '@tanstack/react-router';
import { REGEXP_ONLY_DIGITS } from 'input-otp';
import { Loader2 } from 'lucide-react';
import { type FormEvent, useRef, useState } from 'react';
import { Brand } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';
import { api, useAuth } from '@/lib/auth';

function messageOf(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong. Try again.';
}

/** docs/SPEC.md §11.1 and §16.5: email, then the 6-digit code from the email. */
export function SignInPage() {
  const auth = useAuth();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const codeInput = useRef<HTMLInputElement>(null);

  // A super admin with no family has only the Admin page.
  if (auth.status === 'signedIn') return <Navigate to={auth.me.family ? '/' : '/admin'} />;

  async function sendCode(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.requestCode(email.trim());
      setCode('');
      setStep('code');
      if (step === 'code') {
        setNotice('We sent a new code.');
        codeInput.current?.focus();
      }
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function verify(value: string) {
    if (value.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.verifyCode(email.trim(), value);
    } catch (err) {
      setError(messageOf(err));
      setCode('');
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 px-4 py-10">
      <Brand />
      <Card className="w-full max-w-sm">
        {step === 'email' ? (
          <>
            <CardHeader>
              <CardTitle>Sign in</CardTitle>
              <CardDescription>We'll email you a 6-digit code.</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="flex flex-col gap-4" onSubmit={sendCode}>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    autoFocus
                    required
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    aria-invalid={error ? true : undefined}
                  />
                </div>
                {error && (
                  <p role="alert" className="text-sm text-danger">
                    {error}
                  </p>
                )}
                <Button type="submit" disabled={busy || email.trim() === ''}>
                  {busy && <Loader2 className="animate-spin" />}
                  Send code
                </Button>
              </form>
            </CardContent>
          </>
        ) : (
          <>
            <CardHeader>
              <CardTitle>Check your email</CardTitle>
              <CardDescription>
                Enter the 6-digit code we sent to <span className="font-medium text-on-surface">{email.trim()}</span>.
                It works for 10 minutes.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <InputOTP
                ref={codeInput}
                maxLength={6}
                pattern={REGEXP_ONLY_DIGITS}
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                value={code}
                onChange={setCode}
                onComplete={(value: string) => void verify(value)}
                aria-label="Sign-in code"
                containerClassName="justify-center"
              >
                <InputOTPGroup>
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <InputOTPSlot key={i} index={i} />
                  ))}
                </InputOTPGroup>
              </InputOTP>
              {error && (
                <p role="alert" className="text-center text-sm text-danger">
                  {error}
                </p>
              )}
              {notice && <p className="text-center text-sm text-muted">{notice}</p>}
              <Button disabled={busy || code.length !== 6} onClick={() => void verify(code)}>
                {busy && <Loader2 className="animate-spin" />}
                Sign in
              </Button>
              <div className="flex items-center justify-between text-sm">
                <Button
                  variant="link"
                  disabled={busy}
                  onClick={() => {
                    setStep('email');
                    setError(null);
                    setNotice(null);
                  }}
                >
                  Use a different email
                </Button>
                <Button variant="link" disabled={busy} onClick={() => void sendCode()}>
                  Send a new code
                </Button>
              </div>
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
}
```

### 5.5 `web/src/router.tsx`

The only changes: it imports `AdminPage` instead of `ComingSoon`, and `AdminOnly` returns `<AdminPage />`.

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
import { AdminPage } from '@/pages/admin';
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
  return <AdminPage />;
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

### 5.6 `web/src/pages/coming-soon.tsx`

Delete it with `git rm web/src/pages/coming-soon.tsx`. After 5.5 nothing imports it. Check with `Get-ChildItem web\src -Recurse -File | Select-String 'coming-soon'`: it must print nothing.

### 5.7 `web/test/admin.test.ts`

```typescript
import type { AdminFamily } from '@screentime/schemas';
import { describe, expect, it } from 'vitest';
import { type NewFamilyDraft, familyFacts, newFamilyBody, newFamilyErrors } from '../src/lib/admin';

function family(extra: Partial<AdminFamily> = {}): AdminFamily {
  return {
    id: '30000000-0000-4000-8000-000000000001',
    name: 'Gallagher family',
    timezone: 'Australia/Sydney',
    // 10:30 pm on 25 October 2026 in UTC is already 26 October in Sydney.
    createdAt: '2026-10-25T22:30:00Z',
    disabledAt: null,
    parentCount: 2,
    ...extra,
  };
}

const DRAFT: NewFamilyDraft = {
  name: ' Gallagher family ',
  timezone: 'Australia/Sydney',
  emergencyNumber: '000',
  email: ' james@example.com ',
  displayName: ' Dad ',
  phone: '0412 345 678',
};

describe('familyFacts', () => {
  it('gives the zone, the parents and the start date in the family time zone', () => {
    expect(familyFacts(family())).toBe('Australia / Sydney · 2 parents · Since 26 Oct 2026');
    expect(familyFacts(family({ parentCount: 1, timezone: 'UTC' }))).toBe('UTC · 1 parent · Since 25 Oct 2026');
    expect(familyFacts(family({ parentCount: 0 }))).toContain('0 parents');
  });
});

describe('newFamilyErrors', () => {
  it('accepts a full draft, with or without a mobile', () => {
    expect(newFamilyErrors(DRAFT)).toEqual({});
    expect(newFamilyErrors({ ...DRAFT, phone: '' })).toEqual({});
  });

  it('names every missing or wrong field', () => {
    expect(
      newFamilyErrors({ name: ' ', timezone: 'UTC', emergencyNumber: '9', email: 'james', displayName: '', phone: '12' }),
    ).toEqual({
      name: 'Type a family name.',
      emergencyNumber: 'Use 2 to 6 digits, like 000.',
      email: 'Type an email address.',
      displayName: 'Type a name, like Mum or Dad.',
      phone: 'Type a number like 0412 345 678 or +61412345678.',
    });
  });
});

describe('newFamilyBody', () => {
  it('trims, nests the first parent and stores the mobile in international form', () => {
    expect(newFamilyBody(DRAFT)).toEqual({
      name: 'Gallagher family',
      timezone: 'Australia/Sydney',
      emergencyNumber: '000',
      firstParent: { email: 'james@example.com', displayName: 'Dad', phoneE164: '+61412345678' },
    });
    expect(newFamilyBody({ ...DRAFT, phone: ' ' }).firstParent.phoneE164).toBeNull();
  });
});
```

## 6. Detailed spec

### 6.1 Families page

- The heading is `Families`, with `Every family on this server. Only you, the super admin, see this page.` under it and `New family` on the right.
- One card with a row per family, oldest first as the server sends them. Each row has:
  - a round house icon: teal for an enabled family, grey for a disabled one;
  - the name in medium weight, grey and with a red `Disabled` chip when disabled;
  - under it in grey, for example `Australia / Sydney · 2 parents · Since 26 Oct 2026`. The date is in the family's own time zone, and the word is `parent` for exactly 1;
  - for an enabled family, a `…` menu on the right with `Add parent…`, a separator, and a red `Disable family…`. A disabled family has no menu.
- With no families yet, a grey box shows a house, `No families yet` and `Create the first one with New family.`
- A super admin who is not a parent sees only **Admin** in the side bar. A super admin who is also a parent sees the parent pages and **Admin**.

### 6.2 New family

- The dialog's heading is `New family`, with `The family starts with the usual messages for kids and its own parent code.` under it.
- Fields:
  - `Family name`, with the placeholder `Smith family`;
  - `Time zone`, which starts at the browser's own zone (`Australia / Sydney` on James's PC);
  - `Emergency number`, which starts at `000`. On a wide screen the time zone and emergency number sit side by side.
- Under a line comes `First parent`, with:
  - `Email`, with `They sign in with this email.` under it;
  - `Name the kids see`, with the placeholder `Mum, Dad, Nan…`;
  - `Mobile (optional)`, with `SOS texts go to this number.` under it.
- The button is `Create family`. Errors show under each field after the first try. A mobile like `0412 345 678` is sent as `+61412345678`. An email that already belongs to a parent shows the server's message `That email already belongs to a parent.`
- After it works, the dialog shows a teal tick and `<family> is ready`, then `<name> can sign in now with <email>. No email is sent, so tell them. They add the kids and devices themselves.` and a `Done` button. The list now shows the new family.

### 6.3 Add parent and Disable

- `Add a parent to <family>`, `They sign in with this email. No email is sent, so tell them.` The fields are `Email`, `Name the kids see` and `Mobile (optional)`, then `Add parent`. The row's parent count goes up afterwards.
- `Disable <family>?`, `Its parents are signed out at once and can no longer sign in. The app has no way to turn a family back on.` The buttons are `Cancel` and a red `Disable`. Afterwards the row is grey, has the `Disabled` chip and has no menu, and its parents get no sign-in code.

## 7. Steps

All commands in PowerShell from `C:\Users\james\OpenCode\Testing\ScreenTime` unless stated otherwise.

1. Start from the latest `main` and create the branch:
   ```powershell
   git checkout main
   git pull origin main
   git checkout -b bob/card-026-admin
   pnpm install --frozen-lockfile
   ```
   After the pull, `docs/cards/CARD-026-admin.md` and `web/src/pages/settings.tsx` (CARD-025b) must exist. If one is missing, run `git pull origin main` again, and if it is still missing, stop and ask James.
2. Create 5.1 to 5.3, replace 5.4 and 5.5, and delete 5.6. Run `pnpm build` and `pnpm typecheck`. Commit: `CARD-026: add the Admin page`.
3. Create 5.7. Run `pnpm --filter @screentime/web test`. Commit: `CARD-026: add Admin tests`.
4. Run the acceptance checks in section 8.
5. Push and open the PR (section 10).
6. Wait for both CI checks to finish (`gh pr checks <number> --watch`).
7. Send James the handback report (section 12).

## 8. Acceptance criteria

Never put a real password, JWT secret, SMTP key, Firebase key, FCM token or device token in the PR or the handback.

- [ ] `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm typecheck` and `pnpm test` pass, and `git status --short pnpm-lock.yaml` is empty. `pnpm build` ends the web part with `✓ built in` (the 500 kB chunk warning is expected). Without `TEST_DATABASE_URL`:
  - `packages/schemas`: `Tests  36 passed (36)`.
  - `packages/engine`: `Tests  27 passed (27)`.
  - `web`: `test/format.test.ts (3 tests)`, `test/api.test.ts (6 tests)`, `test/today.test.ts (9 tests)`, `test/kid.test.ts (10 tests)`, `test/inbox.test.ts (8 tests)`, `test/totp.test.ts (4 tests)`, `test/settings.test.ts (5 tests)`, `test/admin.test.ts (4 tests)`, `Tests  49 passed (49)`.
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
  (curl.exe -s http://localhost:5173/src/pages/admin.tsx | Out-String).Length -gt 1000
  ```
  Both print `True`. Stop `pnpm dev:web` with Ctrl+C. Claude checks the pages in a browser with test data after the PR is open; you do not need to sign in.
- [ ] `git status` does **not** list `deploy/.env` or anything in `web/dist/`.
- [ ] Both GitHub Actions checks are green on the PR: **TypeScript / typecheck and test** and **TypeScript / docker compose smoke test**. Wait for them (`gh pr checks <number> --watch`) before you write the handback.
- [ ] Only the expected files changed. `git diff --name-only main...HEAD` lists exactly these 7 files (in any order; `coming-soon.tsx` is listed because it is deleted):
  ```
  web/src/components/new-family-dialog.tsx
  web/src/lib/admin.ts
  web/src/pages/admin.tsx
  web/src/pages/coming-soon.tsx
  web/src/pages/sign-in.tsx
  web/src/router.tsx
  web/test/admin.test.ts
  ```

## 9. Tests

| File | What it asserts |
|---|---|
| `web/test/admin.test.ts` | `familyFacts` gives the zone, the number of parents (`1 parent`, `2 parents`) and the start date in the family's own time zone. `newFamilyErrors` accepts a good draft and flags each bad field with its message. `newFamilyBody` trims the text, turns `0412 345 678` into `+61412345678` and an empty mobile into `null`. |

## 10. Git and pull request

1. Start from the latest `main` (step 1 above).
2. Commit in small logical commits (steps 2 and 3). Message format: `CARD-026: <what changed>`.
3. Before pushing, run every acceptance command again and make sure all pass.
4. Push: `git push -u origin bob/card-026-admin`
5. Open a PR into `main` titled `CARD-026: Super admin pages`. Write the body to `C:\Users\james\OpenCode\Testing\temp\pr-body.md` (the shared temp folder outside the repo; create it first with `New-Item -ItemType Directory -Force C:\Users\james\OpenCode\Testing\temp | Out-Null`) and run `gh pr create --base main --head bob/card-026-admin --title "CARD-026: Super admin pages" --body-file C:\Users\james\OpenCode\Testing\temp\pr-body.md`. Body:
   ```markdown
   ## Card
   docs/cards/CARD-026-admin.md

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

- **TypeScript or Vite says it cannot find `@/pages/coming-soon`**: you deleted 5.6 but kept the old `router.tsx`. Copy 5.5 again exactly.
- **Special characters**: copy `…`, `·` and `§` exactly. Check with `Select-String -Path web\src\pages\admin.tsx -Pattern '…'` (it should find 3 lines) and `Select-String -Path web\src\lib\admin.ts -Pattern '·'` (it should find 2 lines).
- **Blank lines**: do not add or remove any. In CARD-025b one extra blank line in `parents-card.tsx` was the only difference from the card.
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
Claude, here is Bob's handback for CARD-026. Please review and merge if it is good.

CARD: CARD-026 Super admin pages
PR: <full PR URL>
Branch: bob/card-026-admin
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
