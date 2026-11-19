import type { DeviceForm, Pool, Today, TodayKid, TodayPool } from '@screentime/schemas';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Moon, RefreshCw, SlidersHorizontal, Users } from 'lucide-react';
import { useState } from 'react';
import { AdjustDialog } from '@/components/adjust-dialog';
import { BedtimeDialog } from '@/components/bedtime-dialog';
import { KidAvatar } from '@/components/kid-avatar';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { api } from '@/lib/auth';
import { bedtimeAction, bedtimeLine, bedtimeOf } from '@/lib/bedtime';
import { isShared, poolLabel, poolsShown, sharedForm, splitByKind } from '@/lib/shared';
import { type Chip, kidChips, POOL_NAMES, poolView, type Tone } from '@/lib/today';
import { cn } from '@/lib/utils';
import { useDevices } from '@/pages/kids';

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

export function PoolRow({
  kid,
  pool,
  label,
  onAdjust,
}: {
  kid: TodayKid;
  pool: TodayPool;
  /** The pool's name; a shared device's says Time. */
  label?: string;
  onAdjust: () => void;
}) {
  const view = poolView(pool);
  const name = label ?? POOL_NAMES[pool.pool];
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

/** The kid's bedtime tonight, under the pools, with Extend or Change (docs/SPEC.md §16.4). */
export function BedtimeRow({ kid, onExtend }: { kid: TodayKid; onExtend: () => void }) {
  const bedtime = bedtimeOf(kid);
  const line = bedtimeLine(bedtime);
  const action = bedtimeAction(bedtime);
  const extended = bedtime.extendedBy !== null;
  return (
    <div className="flex items-center gap-3">
      <span
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-full',
          extended ? 'bg-primary/10 text-primary' : 'bg-surface-variant text-muted',
        )}
      >
        <Moon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{line.text}</p>
        {line.detail && <p className="mt-0.5 text-xs text-muted">{line.detail}</p>}
      </div>
      {action && (
        <Button variant="outline" size="sm" aria-label={`${action} bedtime for ${kid.name}`} onClick={onExtend}>
          {action}
        </Button>
      )}
    </div>
  );
}

/** The status chips under a kid (docs/SPEC.md §16.4); nothing when there are none. */
export function ChipList({ chips }: { chips: Chip[] }) {
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((chip) => (
        <span key={chip.text} className={cn('rounded-full px-3 py-1 text-xs font-medium', CHIP[chip.tone])}>
          {chip.text}
        </span>
      ))}
    </div>
  );
}

function KidCard({
  kid,
  now,
  form,
  onAdjust,
  onBedtime,
}: {
  kid: TodayKid;
  now: Date;
  /** A shared device's form, for its icon. */
  form?: DeviceForm;
  onAdjust: (pool: Pool) => void;
  onBedtime: () => void;
}) {
  const chips = kidChips(kid, now);
  const shared = isShared(kid);
  return (
    <Card>
      <CardContent className="flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <KidAvatar name={kid.name} color={kid.avatarColor} form={shared ? (form ?? 'tablet') : undefined} />
          <h2 className="text-lg font-semibold">
            <Link to="/kids/$kidId" params={{ kidId: kid.id }} className="underline-offset-4 hover:underline">
              {kid.name}
            </Link>
          </h2>
        </div>
        {poolsShown(kid).map((pool) => (
          <PoolRow
            key={pool.pool}
            kid={kid}
            pool={pool}
            label={poolLabel(pool.pool, shared)}
            onAdjust={() => onAdjust(pool.pool)}
          />
        ))}
        <BedtimeRow kid={kid} onExtend={onBedtime} />
        <ChipList chips={chips} />
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
  const [bedtimeKidId, setBedtimeKidId] = useState<string | null>(null);
  const bedtimeKid = data?.kids.find((k) => k.id === bedtimeKidId) ?? null;
  const split = splitByKind(data?.kids ?? []);
  const devices = useDevices();

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
        <>
          <div className="grid gap-4 md:grid-cols-2">
            {split.kids.map((kid) => (
              <KidCard
                key={kid.id}
                kid={kid}
                now={now}
                onAdjust={(pool) => setAdjusting({ kidId: kid.id, pool })}
                onBedtime={() => setBedtimeKidId(kid.id)}
              />
            ))}
          </div>
          {split.shared.length > 0 && (
            <section className="mt-8" aria-labelledby="today-shared">
              <h2 id="today-shared" className="mb-3 text-lg font-semibold">
                Shared devices
              </h2>
              <div className="grid gap-4 md:grid-cols-2">
                {split.shared.map((kid) => (
                  <KidCard
                    key={kid.id}
                    kid={kid}
                    now={now}
                    form={sharedForm(devices.data, kid.id)}
                    onAdjust={(pool) => setAdjusting({ kidId: kid.id, pool })}
                    onBedtime={() => setBedtimeKidId(kid.id)}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}
      <AdjustDialog kid={adjustKid} pool={adjusting?.pool ?? 'screens'} onClose={() => setAdjusting(null)} />
      <BedtimeDialog kid={bedtimeKid} onClose={() => setBedtimeKidId(null)} />
    </>
  );
}
