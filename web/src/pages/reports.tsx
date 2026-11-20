import type { Kid } from '@screentime/schemas';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { BarChart3, ChevronDown, ChevronLeft, ChevronRight, Monitor, Smartphone, Tablet } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDuration } from '@/lib/format';
import {
  type AppReport,
  type AppReportApp,
  type AppReportDevice,
  barPercent,
  currentLabel,
  deviceSplit,
  fetchAppReport,
  hasUnrecorded,
  isCurrentPeriod,
  localToday,
  periodDates,
  periodLabel,
  type ReportPeriod,
  type ReportSearch,
  removedLine,
  screenTimeLabel,
  shortDuration,
  shiftPeriod,
  splitOther,
} from '@/lib/reports';
import { isShared, splitByKind } from '@/lib/shared';
import { cn } from '@/lib/utils';
import { useKids } from '@/pages/kids';

const PERIODS: { value: ReportPeriod; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

const FORM_ICONS = { phone: Smartphone, tablet: Tablet, pc: Monitor };

function messageOf(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong. Try again.';
}

/** docs/SPEC.md §12.9: the apps report of a kid or shared device, by day, week or month, on all devices or one. */
export function ReportsPage({ search }: { search: ReportSearch }) {
  const auth = useAuth();
  const timeZone = (auth.status === 'signedIn' && auth.me.family?.timezone) || 'UTC';
  const today = localToday(timeZone);
  const kids = useKids();
  const navigate = useNavigate();
  const list = kids.data ?? [];
  const kid = list.find((k) => k.id === search.kid) ?? splitByKind(list).kids[0] ?? list[0];
  const period = search.period ?? 'week';
  const date = search.date && search.date <= today ? search.date : today;
  const deviceId = kid && !isShared(kid) ? (search.device ?? null) : null;

  const go = (next: ReportSearch) =>
    void navigate({ to: '/reports', search: { kid: kid?.id, device: deviceId ?? undefined, period, date, ...next } });

  const report = useQuery({
    queryKey: ['app-report', kid?.id, period, date, deviceId],
    queryFn: () => fetchAppReport({ kidId: kid!.id, period, date, deviceId }),
    enabled: !!kid,
    placeholderData: keepPreviousData,
  });

  if (kids.isPending) {
    return (
      <>
        <PageHeader title="Reports" />
        <Card className="h-64 animate-pulse bg-surface-variant/50" aria-label="Loading" />
      </>
    );
  }
  if (!kid) {
    return (
      <>
        <PageHeader title="Reports" />
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-surface-variant text-muted">
              <BarChart3 className="size-6" />
            </span>
            <p className="font-medium">Nothing to report yet</p>
            <p className="max-w-sm text-sm text-muted">Add a kid and their devices first. Reports show which apps they use and for how long.</p>
          </CardContent>
        </Card>
      </>
    );
  }

  const current = isCurrentPeriod(period, date, today);
  const shared = isShared(kid);
  return (
    <>
      <PageHeader title="Reports" description="Which apps were used, and for how long." />
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <KidPicker kids={list} value={kid.id} onChange={(id) => go({ kid: id, device: undefined })} />
        <Tabs value={period} onValueChange={(v) => go({ period: v as ReportPeriod })}>
          <TabsList aria-label="Period">
            {PERIODS.map((p) => (
              <TabsTrigger key={p.value} value={p.value}>
                {p.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <div className="mb-4 flex items-center gap-2">
        <Button variant="ghost" size="icon" aria-label="Before" onClick={() => go({ date: shiftPeriod(period, date, -1) })}>
          <ChevronLeft />
        </Button>
        <div className="min-w-0 flex-1 text-center">
          <p className="text-lg font-semibold">{periodLabel(period, date, today)}</p>
          <p className="text-sm text-muted">{periodDates(period, date)}</p>
        </div>
        <Button variant="ghost" size="icon" aria-label="After" disabled={current} onClick={() => go({ date: shiftPeriod(period, date, 1) })}>
          <ChevronRight />
        </Button>
      </div>
      {!current && (
        <div className="-mt-2 mb-4 flex justify-center">
          <Button variant="link" onClick={() => go({ date: today })}>
            {currentLabel(period)}
          </Button>
        </div>
      )}
      {report.error ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="text-sm text-danger">{messageOf(report.error)}</p>
            <Button variant="outline" onClick={() => void report.refetch()}>
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : !report.data ? (
        <div className="flex flex-col gap-4" aria-label="Loading">
          <Card className="h-28 animate-pulse bg-surface-variant/50" />
          <Card className="h-72 animate-pulse bg-surface-variant/50" />
        </div>
      ) : (
        <div className={cn('flex flex-col gap-4 transition-opacity', report.isPlaceholderData && 'opacity-60')}>
          {!shared && <DeviceChips report={report.data} onChange={(id) => go({ device: id ?? undefined })} />}
          <ScreenTimeCard report={report.data} shared={shared} />
          <AppsCard report={report.data} timeZone={timeZone} />
        </div>
      )}
    </>
  );
}

function KidPicker({ kids, value, onChange }: { kids: Kid[]; value: string; onChange: (id: string) => void }) {
  const split = splitByKind(kids);
  return (
    <Select className="w-full lg:w-64" aria-label="Kid or shared device" value={value} onChange={(e) => onChange(e.target.value)}>
      {split.kids.length > 0 && (
        <optgroup label="Kids">
          {split.kids.map((k) => (
            <option key={k.id} value={k.id}>
              {k.name}
            </option>
          ))}
        </optgroup>
      )}
      {split.shared.length > 0 && (
        <optgroup label="Shared devices">
          {split.shared.map((k) => (
            <option key={k.id} value={k.id}>
              {k.name}
            </option>
          ))}
        </optgroup>
      )}
    </Select>
  );
}

function DeviceChips({ report, onChange }: { report: AppReport; onChange: (deviceId: string | null) => void }) {
  if (report.devices.length < 2) return null;
  const chip = (selected: boolean) =>
    cn(
      'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary',
      selected ? 'border-primary bg-primary/10 text-primary' : 'border-outline bg-surface text-on-surface hover:bg-surface-variant',
    );
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]" role="group" aria-label="Devices">
      <button type="button" className={chip(report.deviceId === null)} aria-pressed={report.deviceId === null} onClick={() => onChange(null)}>
        All devices
      </button>
      {report.devices.map((d) => {
        const Icon = FORM_ICONS[d.form];
        const selected = report.deviceId === d.deviceId;
        return (
          <button key={d.deviceId} type="button" className={chip(selected)} aria-pressed={selected} onClick={() => onChange(d.deviceId)}>
            <Icon className="size-4" />
            {d.name}
            {d.removedAt && <span className="text-xs font-normal text-muted">· removed</span>}
          </button>
        );
      })}
    </div>
  );
}

function ScreenTimeCard({ report, shared }: { report: AppReport; shared: boolean }) {
  const device: AppReportDevice | null = report.devices.find((d) => d.deviceId === report.deviceId) ?? null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Screen time</CardTitle>
        <CardDescription>
          {device ? 'Time this device was in use.' : 'Time in use, counted once when two devices were used together.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {report.screenTime.length === 0 ? (
          <p className="text-sm text-muted">No devices in this report.</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:flex sm:gap-10">
            {report.screenTime.map((p) => (
              <div key={p.pool}>
                <p className="text-sm text-muted">{screenTimeLabel(p.pool, shared, device)}</p>
                <p className="text-2xl font-semibold tabular-nums">{p.usedSec === 0 ? '0m' : formatDuration(p.usedSec)}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AppsCard({ report, timeZone }: { report: AppReport; timeZone: string }) {
  const [otherOpen, setOtherOpen] = useState(false);
  const { shown, other, otherSec } = splitOther(report.apps);
  const max = report.apps[0]?.totalSec ?? 0;
  const unrecorded = hasUnrecorded(report);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Apps</CardTitle>
        <CardDescription>Most used first. App time and screen time can differ a little: the Screen Time app itself counts only as screen time, and always-allowed apps only as app time.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        {unrecorded && (
          <p className="mb-2 rounded-xl bg-surface-variant px-3 py-2 text-sm text-muted">Apps on a PC aren't recorded yet.</p>
        )}
        {report.apps.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">No apps used in this {report.period}.</p>
        ) : (
          <ul className="flex flex-col">
            {shown.map((app) => (
              <AppRow key={app.package} app={app} report={report} max={max} timeZone={timeZone} />
            ))}
            {other.length > 0 && (
              <li>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-xl px-1 py-3 text-left outline-none hover:bg-surface-variant/50 focus-visible:ring-2 focus-visible:ring-primary"
                  aria-expanded={otherOpen}
                  onClick={() => setOtherOpen((o) => !o)}
                >
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">Other</span>
                    <span className="block text-sm text-muted">
                      {other.length} {other.length === 1 ? 'app' : 'apps'} under a minute each
                    </span>
                  </span>
                  <span className="text-sm tabular-nums text-muted">{shortDuration(otherSec)}</span>
                  <ChevronDown className={cn('size-4 text-muted transition-transform', otherOpen && 'rotate-180')} />
                </button>
                {otherOpen && (
                  <ul className="mb-2 ml-1 border-l border-outline pl-3">
                    {other.map((app) => (
                      <AppRow key={app.package} app={app} report={report} max={max} timeZone={timeZone} small />
                    ))}
                  </ul>
                )}
              </li>
            )}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function AppRow({ app, report, max, timeZone, small }: { app: AppReportApp; report: AppReport; max: number; timeZone: string; small?: boolean }) {
  const split = deviceSplit(app, report);
  const removed = removedLine(app, timeZone);
  return (
    <li className={cn('flex flex-col gap-1.5 px-1', small ? 'py-2' : 'py-3')}>
      <div className="flex items-baseline gap-3">
        <span className={cn('min-w-0 flex-1 truncate font-medium', small && 'text-sm')} title={app.package}>
          {app.label}
        </span>
        <span className="text-sm tabular-nums">{shortDuration(app.totalSec)}</span>
      </div>
      {!small && (
        <div className="h-2 overflow-hidden rounded-full bg-surface-variant" aria-hidden>
          <div className="h-full rounded-full bg-primary" style={{ width: `${barPercent(app.totalSec, max)}%` }} />
        </div>
      )}
      {(split || removed) && (
        <p className="text-xs text-muted">
          {removed && <span className="font-medium text-warning">{removed}</span>}
          {removed && split && ' · '}
          {split}
        </p>
      )}
    </li>
  );
}
