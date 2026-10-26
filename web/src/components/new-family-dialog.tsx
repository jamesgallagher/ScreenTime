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
