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

function PoolRow({ kid, pool, onAdjust }: { kid: TodayKid; pool: TodayPool; onAdjust: () => void }) {
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

function KidCard({ kid, now, onAdjust }: { kid: TodayKid; now: Date; onAdjust: (pool: Pool) => void }) {
  const chips = kidChips(kid, now);
  return (
    <Card>
      <CardContent className="flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <KidAvatar name={kid.name} color={kid.avatarColor} />
          <h2 className="text-lg font-semibold">{kid.name}</h2>
        </div>
        {kid.pools.map((pool) => (
          <PoolRow key={pool.pool} kid={kid} pool={pool} onAdjust={() => onAdjust(pool.pool)} />
        ))}
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {chips.map((chip) => (
              <span key={chip.text} className={cn('rounded-full px-3 py-1 text-xs font-medium', CHIP[chip.tone])}>
                {chip.text}
              </span>
            ))}
          </div>
        )}
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
