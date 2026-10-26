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
