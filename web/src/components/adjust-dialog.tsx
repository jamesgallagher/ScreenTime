import type { Grant, Pool, TodayKid } from '@screentime/schemas';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Lock, Minus, Plus } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ApiError } from '@/lib/api';
import { api } from '@/lib/auth';
import { formatDuration } from '@/lib/format';
import {
  ADJUST_MAX,
  ADJUST_MIN,
  ADJUST_STEP,
  adjustPreview,
  clampAdjust,
  formatAdjust,
  POOL_NAMES,
} from '@/lib/today';
import { cn } from '@/lib/utils';

const QUICK = [15, 30, 60, 120];

function messageOf(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong. Try again.';
}

function PoolSwitch({ value, onChange }: { value: Pool; onChange: (pool: Pool) => void }) {
  return (
    <div role="radiogroup" aria-label="Pool" className="grid grid-cols-2 gap-1 rounded-full bg-surface-variant p-1">
      {(['screens', 'phone'] as const).map((pool) => (
        <button
          key={pool}
          type="button"
          role="radio"
          aria-checked={value === pool}
          onClick={() => onChange(pool)}
          className={cn(
            'h-10 rounded-full text-sm font-medium text-muted transition-colors',
            value === pool && 'bg-surface text-on-surface shadow-sm',
          )}
        >
          {POOL_NAMES[pool]}
        </button>
      ))}
    </div>
  );
}

/** The dialog's body: mounted fresh each time it opens, so it starts at +15m with new request ids. */
function AdjustBody({ kid, initialPool, onDone }: { kid: TodayKid; initialPool: Pool; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [pool, setPool] = useState<Pool>(initialPool);
  const [minutes, setMinutes] = useState(ADJUST_STEP);
  const [confirmLock, setConfirmLock] = useState(false);
  // Made once per opening: a retry after a lost answer sends the same id and cannot add the time twice.
  const [grantId] = useState(() => crypto.randomUUID());
  const [lockId] = useState(() => crypto.randomUUID());
  const today = kid.pools.find((p) => p.pool === pool);

  const done = () => {
    void queryClient.invalidateQueries({ queryKey: ['today'] });
    onDone();
  };
  const grant = useMutation({
    mutationFn: () => api.post<Grant>(`/v1/kids/${kid.id}/grants`, { id: grantId, pool, minutes }),
    onSuccess: done,
  });
  const lockNow = useMutation({
    mutationFn: () => api.post<Grant>(`/v1/kids/${kid.id}/lock-now`, { id: lockId, pool }),
    onSuccess: done,
  });
  const busy = grant.isPending || lockNow.isPending;
  const error = grant.error ?? lockNow.error;

  if (!today) return null;

  if (confirmLock) {
    return (
      <>
        <DialogTitle>
          Lock {POOL_NAMES[pool]} for {kid.name} now?
        </DialogTitle>
        <DialogDescription>
          This takes away the {formatDuration(today.remainingSec)} left today. {kid.name} can still ask for more time.
        </DialogDescription>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {messageOf(error)}
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Button variant="outline" disabled={busy} onClick={() => setConfirmLock(false)}>
            Cancel
          </Button>
          <Button variant="danger" disabled={busy} onClick={() => lockNow.mutate()}>
            {lockNow.isPending ? <Loader2 className="animate-spin" /> : <Lock />}
            Lock now
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      <DialogTitle>Adjust time for {kid.name}</DialogTitle>
      <PoolSwitch
        value={pool}
        onChange={(p) => {
          setPool(p);
          grant.reset();
        }}
      />

      <div className="flex items-center justify-between gap-4">
        <Button
          variant="outline"
          size="icon"
          aria-label="15 minutes less"
          disabled={minutes <= ADJUST_MIN}
          onClick={() => setMinutes((m) => clampAdjust(m - ADJUST_STEP))}
        >
          <Minus />
        </Button>
        <div className="text-center">
          <p
            className={cn('text-4xl font-semibold tabular-nums', minutes < 0 && 'text-danger')}
            aria-live="polite"
            data-testid="adjust-value"
          >
            {minutes === 0 ? '0m' : formatAdjust(minutes)}
          </p>
          <p className="mt-1 text-sm text-muted">{minutes < 0 ? 'Take away' : 'Add'} today only</p>
        </div>
        <Button
          variant="outline"
          size="icon"
          aria-label="15 minutes more"
          disabled={minutes >= ADJUST_MAX}
          onClick={() => setMinutes((m) => clampAdjust(m + ADJUST_STEP))}
        >
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
            {formatAdjust(q)}
          </button>
        ))}
      </div>

      <p className="text-center text-sm text-muted">{adjustPreview(today, minutes)}</p>

      {error && (
        <p role="alert" className="text-center text-sm text-danger">
          {messageOf(error)}
        </p>
      )}

      <Button disabled={busy || minutes === 0} onClick={() => grant.mutate()}>
        {grant.isPending && <Loader2 className="animate-spin" />}
        {minutes < 0 ? `Take away ${formatDuration(-minutes * 60)}` : `Add ${formatDuration(Math.max(0, minutes) * 60)}`}
      </Button>
      <Button
        variant="link"
        className="self-center text-danger"
        disabled={busy || today.locked}
        onClick={() => {
          lockNow.reset();
          setConfirmLock(true);
        }}
      >
        {today.locked ? `${POOL_NAMES[pool]} is already locked` : `Lock ${POOL_NAMES[pool]} now`}
      </Button>
    </>
  );
}

/** docs/SPEC.md §16.4 adjust sheet, as a dialog: pool, ±15-minute steps from −4h to +8h, a preview, Apply, Lock now. */
export function AdjustDialog({
  kid,
  pool,
  onClose,
}: {
  kid: TodayKid | null;
  pool: Pool;
  onClose: () => void;
}) {
  return (
    <Dialog open={kid !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>{kid && <AdjustBody kid={kid} initialPool={pool} onDone={onClose} />}</DialogContent>
    </Dialog>
  );
}
