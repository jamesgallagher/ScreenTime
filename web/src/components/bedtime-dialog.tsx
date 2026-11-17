import type { TodayKid } from '@screentime/schemas';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Minus, Moon, Plus } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ApiError } from '@/lib/api';
import {
  bedtimeChoices,
  bedtimeClock,
  bedtimeOf,
  endBedtimeExtension,
  extendBedtime,
  laterText,
  quickChoices,
  startChoice,
  stepChoice,
} from '@/lib/bedtime';
import { formatClock } from '@/lib/schedule';
import { cn } from '@/lib/utils';

function messageOf(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong. Try again.';
}

/** The dialog's body: mounted fresh each time it opens, so it starts from tonight's bedtime. */
function BedtimeBody({ kid, onDone }: { kid: TodayKid; onDone: () => void }) {
  const queryClient = useQueryClient();
  const bedtime = bedtimeOf(kid);
  const choices = bedtimeChoices(bedtime);
  const [value, setValue] = useState(() => startChoice(bedtime));
  const extended = bedtime.extendedBy !== null;

  const done = () => {
    void queryClient.invalidateQueries({ queryKey: ['today'] });
    onDone();
  };
  const save = useMutation({ mutationFn: (to: string) => extendBedtime(kid.id, to), onSuccess: done });
  const undo = useMutation({ mutationFn: () => endBedtimeExtension(kid.id), onSuccess: done });
  const busy = save.isPending || undo.isPending;
  const error = save.error ?? undo.error;

  return (
    <>
      <DialogTitle>{extended ? `Change ${kid.name}'s bedtime tonight` : `Extend bedtime for ${kid.name}`}</DialogTitle>
      <DialogDescription>
        Tonight only. {kid.name} can keep using any time left until the new bedtime. With no time left, the
        always-allowed apps keep working until then.
      </DialogDescription>

      {value === null ? (
        <p className="py-6 text-center text-sm text-muted">It's too late to move bedtime tonight.</p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-4">
            <Button
              variant="outline"
              size="icon"
              aria-label="15 minutes earlier"
              disabled={busy || choices.indexOf(value) <= 0}
              onClick={() => setValue((v) => (v === null ? v : stepChoice(choices, v, -1)))}
            >
              <Minus />
            </Button>
            <div className="text-center">
              <p className="text-4xl font-semibold tabular-nums" aria-live="polite" data-testid="bedtime-value">
                {bedtimeClock(value)}
              </p>
              <p className="mt-1 text-sm text-muted">{laterText(bedtime, value)}</p>
            </div>
            <Button
              variant="outline"
              size="icon"
              aria-label="15 minutes later"
              disabled={busy || choices.indexOf(value) >= choices.length - 1}
              onClick={() => setValue((v) => (v === null ? v : stepChoice(choices, v, 1)))}
            >
              <Plus />
            </Button>
          </div>

          <div className="flex flex-wrap justify-center gap-2">
            {quickChoices(bedtime).map((q) => (
              <button
                key={q.label}
                type="button"
                disabled={busy || q.value === null}
                onClick={() => q.value && setValue(q.value)}
                className={cn(
                  'h-9 rounded-full border border-outline px-4 text-sm font-medium transition-colors hover:bg-surface-variant disabled:pointer-events-none disabled:opacity-40',
                  q.value !== null && value === q.value && 'border-primary bg-primary/10 text-primary',
                )}
              >
                {q.label}
              </button>
            ))}
          </div>
        </>
      )}

      {error && (
        <p role="alert" className="text-center text-sm text-danger">
          {messageOf(error)}
        </p>
      )}

      {value !== null && (
        <Button disabled={busy || (extended && value === bedtime.tonight)} onClick={() => save.mutate(value)}>
          {save.isPending ? <Loader2 className="animate-spin" /> : <Moon />}
          Extend to {bedtimeClock(value)}
        </Button>
      )}
      {extended && (
        <Button variant="link" className="self-center text-danger" disabled={busy} onClick={() => undo.mutate()}>
          {undo.isPending && <Loader2 className="animate-spin" />}
          Back to {formatClock(bedtime.scheduled)}
        </Button>
      )}
    </>
  );
}

/** docs/SPEC.md §16.4 extend bedtime, as a dialog: a later bedtime for tonight in 15-minute steps, or back to usual. */
export function BedtimeDialog({ kid, onClose }: { kid: TodayKid | null; onClose: () => void }) {
  return (
    <Dialog open={kid !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>{kid && <BedtimeBody kid={kid} onDone={onClose} />}</DialogContent>
    </Dialog>
  );
}
