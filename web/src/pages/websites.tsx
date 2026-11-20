import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ChevronDown, EyeOff, Globe, MoreVertical, Search, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { DeviceChips, PeriodControls, ReportSwitch } from '@/components/report-controls';
import { SiteClassDialog } from '@/components/site-class-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDuration } from '@/lib/format';
import { barPercent, localToday, type ReportSearch } from '@/lib/reports';
import { isShared, splitByKind } from '@/lib/shared';
import {
  activeTime,
  appsLine,
  browserLabel,
  categoryLabel,
  dayLabel,
  engineLabel,
  fetchSiteReport,
  filterSites,
  hasPc,
  isWorthALook,
  kindLabel,
  notRecorded,
  ownerLine,
  searchWhen,
  shortTime,
  type SiteCategory,
  siteDeviceSplit,
  siteName,
  type SiteReport,
  type SiteReportSite,
  SITES_SHOWN,
  sourceLine,
  titlesCut,
  whenLine,
} from '@/lib/sites';
import { cn } from '@/lib/utils';
import { useKids } from '@/pages/kids';

function messageOf(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong. Try again.';
}

type Filter = SiteCategory | null | 'all';

/** docs/SPEC.md §12.10: the websites report of a kid or shared device, next to Apps, with the same choices. */
export function WebsitesPage({ search }: { search: ReportSearch }) {
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
  const [editing, setEditing] = useState<SiteReportSite | null>(null);

  const go = (next: ReportSearch) =>
    void navigate({ to: '/reports/websites', search: { kid: kid?.id, device: deviceId ?? undefined, period, date, ...next } });

  const report = useQuery({
    queryKey: ['site-report', kid?.id, period, date, deviceId],
    queryFn: () => fetchSiteReport({ kidId: kid!.id, period, date, deviceId }),
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
              <Globe className="size-6" />
            </span>
            <p className="font-medium">Nothing to report yet</p>
            <p className="max-w-sm text-sm text-muted">Add a kid and their devices first. Reports show which websites their devices look up.</p>
          </CardContent>
        </Card>
      </>
    );
  }

  const shared = isShared(kid);
  return (
    <>
      <PageHeader title="Reports" description="Which websites the devices looked up, in any browser and in private windows too." />
      <ReportSwitch active="websites" search={{ kid: kid.id, device: deviceId ?? undefined, period, date }} />
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
          <Card className="h-40 animate-pulse bg-surface-variant/50" />
          <Card className="h-72 animate-pulse bg-surface-variant/50" />
        </div>
      ) : (
        <div className={cn('flex flex-col gap-4 transition-opacity', report.isPlaceholderData && 'opacity-60')}>
          {!shared && (
            <DeviceChips devices={report.data.devices} deviceId={report.data.deviceId} onChange={(id) => go({ device: id ?? undefined })} />
          )}
          <Report report={report.data} timeZone={timeZone} onEdit={setEditing} />
        </div>
      )}
      <SiteClassDialog site={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function Report({ report, timeZone, onEdit }: { report: SiteReport; timeZone: string; onEdit: (site: SiteReportSite) => void }) {
  const [filter, setFilter] = useState<Filter>('all');
  const missing = notRecorded(report);
  const worth = report.sites.filter((s) => isWorthALook(s.category));
  return (
    <>
      {missing.length > 0 && (
        <p className="rounded-xl bg-surface-variant px-3 py-2 text-sm text-muted">
          {missing.map((d) => d.name).join(', ')} {missing.length === 1 ? "hasn't" : "haven't"} sent any websites yet. A PC needs the latest Screen Time.
        </p>
      )}
      {worth.length > 0 && <WorthALookCard sites={worth} onPick={(c) => setFilter(c)} />}
      {report.categories.length > 0 && <CategoriesCard report={report} filter={filter} onFilter={setFilter} />}
      <SitesCard report={report} timeZone={timeZone} filter={filter} onFilter={setFilter} onEdit={onEdit} />
      {report.behindTheScenes.length > 0 && <BehindCard report={report} timeZone={timeZone} onEdit={onEdit} />}
      {hasPc(report) && <PcCard report={report} timeZone={timeZone} />}
    </>
  );
}

function WorthALookCard({ sites, onPick }: { sites: SiteReportSite[]; onPick: (category: SiteCategory) => void }) {
  return (
    <Card className="border-danger/40">
      <CardContent className="flex gap-3 py-4">
        <ShieldAlert className="mt-0.5 size-5 shrink-0 text-danger" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            {sites.length === 1 ? '1 site' : `${sites.length} sites`} worth a look
          </p>
          <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm">
            {sites.map((s) => (
              <li key={s.site}>
                <button
                  type="button"
                  className="rounded text-left underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary"
                  onClick={() => s.category && onPick(s.category)}
                >
                  <span className="font-medium">{siteName(s)}</span> <span className="text-muted">{categoryLabel(s.category)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

function CategoriesCard({ report, filter, onFilter }: { report: SiteReport; filter: Filter; onFilter: (f: Filter) => void }) {
  const max = report.categories[0]?.minutes ?? 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Categories</CardTitle>
        <CardDescription>Active time on websites, by category. Pick one to see its sites.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-x-8 sm:grid-cols-2">
          {report.categories.map((c) => {
            const selected = filter === c.category;
            const flagged = isWorthALook(c.category);
            return (
              <li key={c.category ?? 'unsorted'}>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onFilter(selected ? 'all' : c.category)}
                  className={cn(
                    'flex w-full flex-col gap-1.5 rounded-xl px-2 py-2.5 text-left outline-none transition-colors hover:bg-surface-variant/60 focus-visible:ring-2 focus-visible:ring-primary',
                    selected && 'bg-primary/10',
                  )}
                >
                  <span className="flex items-baseline gap-2">
                    <span className={cn('min-w-0 flex-1 truncate text-sm font-medium', flagged && 'text-danger', c.category === null && 'text-muted')}>
                      {categoryLabel(c.category)}
                    </span>
                    <span className="text-xs text-muted">
                      {c.sites} {c.sites === 1 ? 'site' : 'sites'}
                    </span>
                    <span className="text-sm tabular-nums">{activeTime(c.minutes)}</span>
                  </span>
                  <span className="h-1.5 overflow-hidden rounded-full bg-surface-variant" aria-hidden>
                    <span
                      className={cn('block h-full rounded-full', flagged ? 'bg-danger' : c.category === null ? 'bg-muted' : 'bg-primary')}
                      style={{ width: `${barPercent(c.minutes, max)}%` }}
                    />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function SitesCard({
  report,
  timeZone,
  filter,
  onFilter,
  onEdit,
}: {
  report: SiteReport;
  timeZone: string;
  filter: Filter;
  onFilter: (f: Filter) => void;
  onEdit: (site: SiteReportSite) => void;
}) {
  const [all, setAll] = useState(false);
  const sites = filterSites(report.sites, filter);
  const shown = all ? sites : sites.slice(0, SITES_SHOWN);
  const max = sites[0]?.minutes ?? 0;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>{filter === 'all' ? 'Websites' : `Websites: ${categoryLabel(filter)}`}</CardTitle>
            <CardDescription className="mt-1.5">
              Seen on the device, not necessarily opened: a page can bring in other sites. Active time counts the minutes in which a site was
              looked up, a rough guide to how much it was used.
            </CardDescription>
          </div>
          {filter !== 'all' && (
            <Button variant="outline" onClick={() => onFilter('all')}>
              Show all
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {sites.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">No websites in this {report.period}.</p>
        ) : (
          <>
            <ul className="flex flex-col">
              {shown.map((s) => (
                <SiteRow key={s.site} site={s} report={report} max={max} timeZone={timeZone} onEdit={onEdit} />
              ))}
            </ul>
            {!all && sites.length > SITES_SHOWN && (
              <div className="mt-2 flex justify-center">
                <Button variant="outline" onClick={() => setAll(true)}>
                  Show all {sites.length} sites
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function SiteRow({
  site,
  report,
  max,
  timeZone,
  onEdit,
  small,
}: {
  site: SiteReportSite;
  report: SiteReport;
  max: number;
  timeZone: string;
  onEdit: (site: SiteReportSite) => void;
  small?: boolean;
}) {
  const flagged = isWorthALook(site.category);
  const split = siteDeviceSplit(site, report);
  const source = sourceLine(site);
  const owner = ownerLine(site);
  const name = siteName(site);
  return (
    <li className={cn('flex gap-3 border-t border-outline px-1 first:border-t-0', small ? 'py-2' : 'py-3')}>
      {!small && (
        <span
          className={cn(
            'mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold uppercase',
            flagged ? 'bg-danger/15 text-danger' : 'bg-surface-variant text-muted',
          )}
          aria-hidden
        >
          {name.replace(/^www\./, '').charAt(0)}
        </span>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 truncate font-medium" title={site.site}>
            {name}
          </span>
          {site.label && <span className="hidden min-w-0 truncate text-xs text-muted sm:inline">{site.site}</span>}
          <span className="flex-1" />
          <span className="text-sm tabular-nums">{activeTime(site.minutes)}</span>
        </div>
        {!small && (
          <div className="h-2 overflow-hidden rounded-full bg-surface-variant" aria-hidden>
            <div className={cn('h-full rounded-full', flagged ? 'bg-danger' : 'bg-primary')} style={{ width: `${barPercent(site.minutes, max)}%` }} />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <span
            className={cn(
              'rounded-full px-2 py-0.5 font-medium',
              flagged ? 'bg-danger/15 text-danger' : site.kind === null ? 'border border-dashed border-outline' : 'bg-surface-variant text-on-surface',
            )}
          >
            {small ? kindLabel(site.kind) : site.kind === 'unknown' ? 'Unknown' : categoryLabel(site.category)}
          </span>
          {owner && <span>{owner}</span>}
          <span>{appsLine(site)}</span>
          <span>·</span>
          <span>{whenLine(site, report.period, timeZone)}</span>
          {split && (
            <>
              <span>·</span>
              <span>{split}</span>
            </>
          )}
        </div>
        {source && <p className={cn('text-xs', site.source === 'family_dns' ? 'font-medium text-danger' : 'text-muted')}>{source}</p>}
      </div>
      <Button variant="ghost" size="icon" className="-mr-2 size-9 self-start" aria-label={`Change what ${name} is`} onClick={() => onEdit(site)}>
        <MoreVertical />
      </Button>
    </li>
  );
}

function BehindCard({ report, timeZone, onEdit }: { report: SiteReport; timeZone: string; onEdit: (site: SiteReportSite) => void }) {
  const [open, setOpen] = useState(false);
  const sites = report.behindTheScenes;
  const max = sites[0]?.minutes ?? 0;
  return (
    <Card>
      <button
        type="button"
        className="flex w-full items-center gap-3 rounded-[inherit] px-6 py-5 text-left outline-none hover:bg-surface-variant/40 focus-visible:ring-2 focus-visible:ring-primary"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">Behind the scenes</span>
          <span className="block text-sm text-muted">
            {sites.length} {sites.length === 1 ? 'site' : 'sites'} that serve files, ads or apps for other sites. Nobody opens these.
          </span>
        </span>
        <ChevronDown className={cn('size-5 text-muted transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <CardContent>
          <ul className="flex flex-col">
            {sites.map((s) => (
              <SiteRow key={s.site} site={s} report={report} max={max} timeZone={timeZone} onEdit={onEdit} small />
            ))}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}

function PcCard({ report, timeZone }: { report: SiteReport; timeZone: string }) {
  const cut = titlesCut(report);
  return (
    <Card>
      <CardHeader>
        <CardTitle>On PCs</CardTitle>
        <CardDescription>Read from the browser window in front (Edge, Chrome, Brave, Firefox). Kept for 90 days.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {cut && (
          <p className="rounded-xl bg-surface-variant px-3 py-2 text-sm text-muted">
            Searches and pages before {dayLabel(report.titlesKeptFrom)} are no longer kept.
          </p>
        )}
        <div className="grid grid-cols-3 gap-3">
          <Stat label="In a browser" value={report.browserSec === 0 ? '0m' : formatDuration(report.browserSec)} />
          <Stat
            label="Private windows"
            value={report.privateSec === 0 ? '0m' : shortTime(report.privateSec)}
            tone={report.privateSec > 0 ? 'warning' : undefined}
          />
          <Stat label="Searches" value={String(report.searches.length)} />
        </div>
        <section>
          <h3 className="mb-2 text-sm font-semibold">Searches</h3>
          {report.searches.length === 0 ? (
            <p className="text-sm text-muted">No searches seen.</p>
          ) : (
            <ul className="flex flex-col">
              {report.searches.map((s) => (
                <li key={`${s.engine}:${s.query}`} className="flex items-center gap-3 border-t border-outline py-2.5 first:border-t-0">
                  <Search className="size-4 shrink-0 text-muted" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">“{s.query}”</p>
                    <p className="text-xs text-muted">
                      {engineLabel(s.engine)} · {searchWhen(s.firstAt, report.period, timeZone)}
                    </p>
                  </div>
                  {s.private && <PrivateBadge />}
                  <span className="text-sm tabular-nums text-muted">{shortTime(s.sec)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h3 className="mb-2 text-sm font-semibold">Pages</h3>
          {report.pages.length === 0 ? (
            <p className="text-sm text-muted">No pages seen.</p>
          ) : (
            <ul className="flex flex-col">
              {report.pages.map((p) => (
                <li key={`${p.package}:${p.page}`} className="flex items-center gap-3 border-t border-outline py-2.5 first:border-t-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium" title={p.page}>
                      {p.page}
                    </p>
                    <p className="text-xs text-muted">{browserLabel(p.package)}</p>
                  </div>
                  {p.private && <PrivateBadge />}
                  <span className="text-sm tabular-nums text-muted">{shortTime(p.sec)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </CardContent>
    </Card>
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

function PrivateBadge() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning">
      <EyeOff className="size-3" />
      Private
    </span>
  );
}
