import type { DeviceForm, Kid } from '@screentime/schemas';
import { Link } from '@tanstack/react-router';
import { AppWindow, ChevronLeft, ChevronRight, Globe, Monitor, Smartphone, Tablet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { currentLabel, isCurrentPeriod, periodDates, periodLabel, type ReportPeriod, type ReportSearch, shiftPeriod } from '@/lib/reports';
import { splitByKind } from '@/lib/shared';
import { cn } from '@/lib/utils';

/** The controls the Apps and Websites reports share (docs/SPEC.md §12.9, §12.10). */

const PERIODS: { value: ReportPeriod; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

export const FORM_ICONS: Record<DeviceForm, typeof Smartphone> = { phone: Smartphone, tablet: Tablet, pc: Monitor };

/** Apps · Websites: the same kid, device, period and date carry over. */
export function ReportSwitch({ active, search }: { active: 'apps' | 'websites'; search: ReportSearch }) {
  const tab = (selected: boolean) =>
    cn(
      'inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary',
      selected ? 'bg-primary text-on-primary' : 'text-on-surface hover:bg-surface-variant',
    );
  return (
    <nav className="mb-4 inline-flex gap-1 rounded-full border border-outline bg-surface p-1" aria-label="Report">
      <Link to="/reports" search={search} className={tab(active === 'apps')} aria-current={active === 'apps' ? 'page' : undefined}>
        <AppWindow className="size-4" />
        Apps
      </Link>
      <Link to="/reports/websites" search={search} className={tab(active === 'websites')} aria-current={active === 'websites' ? 'page' : undefined}>
        <Globe className="size-4" />
        Websites
      </Link>
    </nav>
  );
}

export function KidPicker({ kids, value, onChange }: { kids: Kid[]; value: string; onChange: (id: string) => void }) {
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

/** The kid picker and Day / Week / Month on one row, then the period with ‹ and ›, and the jump back to today. */
export function PeriodControls({
  kids,
  kidId,
  period,
  date,
  today,
  go,
}: {
  kids: Kid[];
  kidId: string;
  period: ReportPeriod;
  date: string;
  today: string;
  go: (next: ReportSearch) => void;
}) {
  const current = isCurrentPeriod(period, date, today);
  return (
    <>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <KidPicker kids={kids} value={kidId} onChange={(id) => go({ kid: id, device: undefined })} />
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
    </>
  );
}

interface ChipDevice {
  deviceId: string;
  name: string;
  form: DeviceForm;
  removedAt: string | null;
}

/** All devices and one chip per device (a removed one says so); none when there is only one device. */
export function DeviceChips({
  devices,
  deviceId,
  onChange,
}: {
  devices: ChipDevice[];
  deviceId: string | null;
  onChange: (deviceId: string | null) => void;
}) {
  if (devices.length < 2) return null;
  const chip = (selected: boolean) =>
    cn(
      'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary',
      selected ? 'border-primary bg-primary/10 text-primary' : 'border-outline bg-surface text-on-surface hover:bg-surface-variant',
    );
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]" role="group" aria-label="Devices">
      <button type="button" className={chip(deviceId === null)} aria-pressed={deviceId === null} onClick={() => onChange(null)}>
        All devices
      </button>
      {devices.map((d) => {
        const Icon = FORM_ICONS[d.form];
        const selected = deviceId === d.deviceId;
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
