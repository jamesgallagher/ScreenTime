import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { EyeOff, Search, SearchX } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { DeviceChips, PeriodControls, ReportSwitch } from '@/components/report-controls';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { localToday, type ReportSearch } from '@/lib/reports';
import {
  deviceName,
  fetchSearchReport,
  filterSearches,
  groupByDay,
  namesList,
  notRecording,
  type SearchReport,
  type SearchReportItem,
  searchTotals,
  timeLine,
  whereLine,
} from '@/lib/searches';
import { isShared, splitByKind } from '@/lib/shared';
import { cn } from '@/lib/utils';
import { useKids } from '@/pages/kids';

function messageOf(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong. Try again.';
}

/** docs/SPEC.md §12.12: every search a kid or shared device's devices sent, next to Apps and Websites. */
export function SearchesPage({ search }: { search: ReportSearch }) {
  const auth = useAuth();
  const timeZone = (auth.status === 'signedIn' && auth.me.family?.timezone) || 'UTC';
  const today = localToday(timeZone);
  const kids = useKids();
  const navigate = useNavigate();
  const list = kids.data ?? [];
  const kid = list.find((k) => k.id === search.kid) ?? splitByKind(list).kids[0] ?? list[0];
  const period = search.period ?? 'day';
  const date = search.date && search.date <= today ? search.date : today;
  const deviceId = kid && !isShared(kid) ? (search.device ?? null) : null;

  const go = (next: ReportSearch) =>
    void navigate({ to: '/reports/searches', search: { kid: kid?.id, device: deviceId ?? undefined, period, date, ...next } });

  const report = useQuery({
    queryKey: ['search-report', kid?.id, period, date, deviceId],
    queryFn: () => fetchSearchReport({ kidId: kid!.id, period, date, deviceId }),
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
              <Search className="size-6" />
            </span>
            <p className="font-medium">Nothing to report yet</p>
            <p className="max-w-sm text-sm text-muted">Add a kid and their devices first. Reports show what they search for.</p>
          </CardContent>
        </Card>
      </>
    );
  }

  const shared = isShared(kid);
  return (
    <>
      <PageHeader title="Reports" description="Every search the devices sent, in private windows too." />
      <ReportSwitch active="searches" search={{ kid: kid.id, device: deviceId ?? undefined, period, date }} />
      <PeriodControls kids={list} kidId={kid.id} period={period} date={date} today={today} go={go} />
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
          {!shared && (
            <DeviceChips devices={report.data.devices} deviceId={report.data.deviceId} onChange={(id) => go({ device: id ?? undefined })} />
          )}
          <Report report={report.data} timeZone={timeZone} />
        </div>
      )}
    </>
  );
}

function Report({ report, timeZone }: { report: SearchReport; timeZone: string }) {
  const [text, setText] = useState('');
  const { off, never } = notRecording(report);
  const totals = searchTotals(report.searches);
  const shown = filterSearches(report.searches, text);
  const days = groupByDay(shown, timeZone, report.today);
  const showDays = report.period !== 'day';
  return (
    <>
      {off.length > 0 && (
        <p className="rounded-xl bg-warning/15 px-3 py-2 text-sm text-on-surface">
          <span className="font-medium">Searches are off on {namesList(off)}.</span> Someone turned off ST Kid under Settings → Accessibility and it
          could not turn itself back on. Turn it on again there, or run the set-up step in the guide.
        </p>
      )}
      {never.length > 0 && (
        <p className="rounded-xl bg-surface-variant px-3 py-2 text-sm text-muted">
          {namesList(never)} {never.length === 1 ? "hasn't" : "haven't"} sent any searches yet. {never.length === 1 ? 'It needs' : 'They need'} the latest
          Screen Time.
        </p>
      )}
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Searches" value={String(totals.searches)} />
        <Stat label="Different words" value={String(totals.different)} />
        <Stat label="In private windows" value={String(totals.private)} tone={totals.private > 0 ? 'warning' : undefined} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Searches</CardTitle>
          <CardDescription>
            Only searches that were sent count, not words typed and deleted. Android: Chrome, the Google app and YouTube. PCs: Edge, Chrome, Brave and
            Firefox.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {report.searches.length > 0 && (
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
              <Input
                className="pl-9"
                placeholder="Find a word"
                aria-label="Find a word in the searches"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </div>
          )}
          {report.searches.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">No searches in this {report.period}.</p>
          ) : shown.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <SearchX className="size-6 text-muted" />
              <p className="text-sm text-muted">No searches with “{text.trim()}”.</p>
              <Button variant="link" onClick={() => setText('')}>
                Show all searches
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {days.map((day) => (
                <section key={day.date} aria-label={day.label}>
                  {showDays && (
                    <h3 className="mb-1 flex items-baseline gap-2 text-sm font-semibold">
                      {day.label}
                      <span className="text-xs font-normal text-muted">
                        {day.searches.length} {day.searches.length === 1 ? 'search' : 'searches'}
                      </span>
                    </h3>
                  )}
                  <ul className="flex flex-col">
                    {day.searches.map((s) => (
                      <SearchRow key={`${s.deviceId}:${s.at}:${s.query}`} item={s} report={report} timeZone={timeZone} />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function SearchRow({ item, report, timeZone }: { item: SearchReportItem; report: SearchReport; timeZone: string }) {
  const device = deviceName(item, report);
  return (
    <li className="flex items-start gap-3 border-t border-outline py-2.5 first:border-t-0">
      <Search className="mt-1 size-4 shrink-0 text-muted" />
      <div className="min-w-0 flex-1">
        <p className="font-medium break-words">“{item.query}”</p>
        <p className="flex flex-wrap gap-x-2 text-xs text-muted">
          <span>{whereLine(item)}</span>
          {device && (
            <>
              <span>·</span>
              <span>{device}</span>
            </>
          )}
          <span>·</span>
          <span className="tabular-nums">{timeLine(item, timeZone)}</span>
        </p>
      </div>
      {item.count > 1 && (
        <span className="shrink-0 rounded-full bg-surface-variant px-2 py-0.5 text-xs font-medium tabular-nums" title={`Seen ${item.count} times`}>
          ×{item.count}
        </span>
      )}
      {item.private === true && (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning">
          <EyeOff className="size-3" />
          Private
        </span>
      )}
    </li>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'warning' }) {
  return (
    <div className={cn('rounded-2xl bg-surface-variant/60 px-3 py-3', tone === 'warning' && 'bg-warning/15')}>
      <p className="text-xs text-muted">{label}</p>
      <p className={cn('text-xl font-semibold tabular-nums', tone === 'warning' && 'text-warning')}>{value}</p>
    </div>
  );
}
