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
