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
