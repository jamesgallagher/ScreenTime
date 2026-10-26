import type { Schedule, ScheduleDay, ScheduleInput } from '@screentime/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Loader2, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { ApiError } from '@/lib/api';
import { api } from '@/lib/auth';
import {
  allowanceOptions,
  copyMondayToWeekdays,
  copySaturdayToWeekend,
  hasErrors,
  type Option,
  scheduleErrors,
  timeOptions,
  WARN1_OPTIONS,
  WARN2_OPTIONS,
  WEEKDAYS,
} from '@/lib/schedule';
import { cn } from '@/lib/utils';

function messageOf(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong. Try again.';
}

function inputOf(schedule: Schedule): ScheduleInput {
  return { warn1Min: schedule.warn1Min, warn2Min: schedule.warn2Min, days: schedule.days };
}

const GRID = 'grid grid-cols-2 gap-3 md:grid-cols-[7.5rem_repeat(4,minmax(0,1fr))] md:items-center';

function Field<T extends string | number>({
  label,
  value,
  options,
  invalid,
  onChange,
}: {
  label: string;
  value: T;
  options: Option<T>[];
  invalid?: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-xs text-muted md:sr-only">{label}</span>
      <Select
        value={String(value)}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange((typeof value === 'number' ? Number(e.target.value) : e.target.value) as T)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </label>
  );
}

function DayRow({ day, error, onChange }: { day: ScheduleDay; error?: string; onChange: (day: ScheduleDay) => void }) {
  const name = WEEKDAYS[day.weekday - 1];
  return (
    <div role="group" aria-label={name} className="border-t border-outline py-3 first:border-t-0">
      <div className={GRID}>
        <p className="col-span-2 text-sm font-semibold md:col-span-1">{name}</p>
        <Field
          label="Screens"
          value={day.screensMin}
          options={allowanceOptions(day.screensMin)}
          onChange={(screensMin) => onChange({ ...day, screensMin })}
        />
        <Field
          label="Phone"
          value={day.phoneMin}
          options={allowanceOptions(day.phoneMin)}
          onChange={(phoneMin) => onChange({ ...day, phoneMin })}
        />
        <Field label="Wake-up" value={day.wake} options={timeOptions('wake', day.wake)} onChange={(wake) => onChange({ ...day, wake })} />
        <Field
          label="Bedtime"
          value={day.bedtime}
          options={timeOptions('bedtime', day.bedtime)}
          invalid={error !== undefined}
          onChange={(bedtime) => onChange({ ...day, bedtime })}
        />
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger md:text-right">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * docs/SPEC.md §16.4 Schedule: 7 rows (Screens and Phone allowance, wake-up, bedtime), the two copy
 * buttons and the two warnings. Saving writes a new schedule version; devices pick it up on their next sync.
 */
export function ScheduleEditor({ kidId, kidName }: { kidId: string; kidName: string }) {
  const queryClient = useQueryClient();
  const schedule = useQuery({
    queryKey: ['schedule', kidId],
    queryFn: () => api.get<Schedule>(`/v1/kids/${kidId}/schedule`),
  });
  // Unsaved edits; null when the form shows the saved schedule.
  const [draft, setDraft] = useState<ScheduleInput | null>(null);
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: (input: ScheduleInput) => api.put<Schedule>(`/v1/kids/${kidId}/schedule`, input),
    onSuccess: (result) => {
      queryClient.setQueryData(['schedule', kidId], result);
      void queryClient.invalidateQueries({ queryKey: ['today'] });
      setDraft(null);
      setSaved(true);
    },
  });

  if (!schedule.data) {
    return schedule.isError ? (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <p className="text-sm text-danger" role="alert">
            {messageOf(schedule.error)}
          </p>
          <Button variant="outline" onClick={() => void schedule.refetch()}>
            <RefreshCw />
            Try again
          </Button>
        </CardContent>
      </Card>
    ) : (
      <Card className="h-96 animate-pulse bg-surface-variant/50" aria-label="Loading" />
    );
  }

  const value = draft ?? inputOf(schedule.data);
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(inputOf(schedule.data));
  const errors = scheduleErrors(value);
  const edit = (next: ScheduleInput) => {
    setDraft(next);
    setSaved(false);
    save.reset();
  };
  const setDay = (day: ScheduleDay) => edit({ ...value, days: value.days.map((d) => (d.weekday === day.weekday ? day : d)) });

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Week</CardTitle>
          <CardDescription>
            Time {kidName} can use each day, and when the devices lock for the night. Bedtime always locks.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className={cn(GRID, 'hidden pb-2 text-xs font-medium text-muted md:grid')} aria-hidden>
            <span />
            <span>Screens</span>
            <span>Phone</span>
            <span>Wake-up</span>
            <span>Bedtime</span>
          </div>
          {value.days.map((day) => (
            <DayRow key={day.weekday} day={day} error={errors.days[day.weekday]} onChange={setDay} />
          ))}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => edit({ ...value, days: copyMondayToWeekdays(value.days) })}>
              <Copy />
              Copy Monday to weekdays
            </Button>
            <Button variant="outline" size="sm" onClick={() => edit({ ...value, days: copySaturdayToWeekend(value.days) })}>
              <Copy />
              Copy Saturday to weekend
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Warnings</CardTitle>
          <CardDescription>How long before time runs out {kidName} gets a warning.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:max-w-md sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">First warning</span>
            <Select
              value={String(value.warn1Min)}
              aria-invalid={errors.warnings !== null || undefined}
              onChange={(e) => edit({ ...value, warn1Min: Number(e.target.value) })}
            >
              {[...new Set([...WARN1_OPTIONS, value.warn1Min])]
                .sort((a, b) => a - b)
                .map((m) => (
                  <option key={m} value={m}>
                    {m} min before
                  </option>
                ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Second warning</span>
            <Select
              value={String(value.warn2Min)}
              aria-invalid={errors.warnings !== null || undefined}
              onChange={(e) => edit({ ...value, warn2Min: Number(e.target.value) })}
            >
              {[...new Set([...WARN2_OPTIONS, value.warn2Min])]
                .sort((a, b) => a - b)
                .map((m) => (
                  <option key={m} value={m}>
                    {m} min before
                  </option>
                ))}
            </Select>
          </label>
          {errors.warnings && (
            <p role="alert" className="text-sm text-danger sm:col-span-2">
              {errors.warnings}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-end gap-3">
        <p aria-live="polite" className="mr-auto text-sm">
          {save.error ? (
            <span className="text-danger">{messageOf(save.error)}</span>
          ) : saved ? (
            <span className="flex items-center gap-1.5 text-primary">
              <Check className="size-4" />
              Saved. {kidName}'s devices pick it up on their next sync.
            </span>
          ) : dirty ? (
            <span className="text-muted">Unsaved changes</span>
          ) : null}
        </p>
        {dirty && (
          <Button variant="ghost" disabled={save.isPending} onClick={() => {
              setDraft(null);
              save.reset();
            }}
          >
            Undo changes
          </Button>
        )}
        <Button disabled={!dirty || hasErrors(errors) || save.isPending} onClick={() => save.mutate(value)}>
          {save.isPending && <Loader2 className="animate-spin" />}
          Save schedule
        </Button>
      </div>
    </div>
  );
}
