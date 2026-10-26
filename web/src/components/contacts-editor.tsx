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
