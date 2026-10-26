import type { Device, ParentModeDuration, TodayDevice } from '@screentime/schemas';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Loader2,
  Monitor,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  Smartphone,
  Tablet,
  Trash2,
} from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { AddDeviceDialog } from '@/components/add-device-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';
import { api } from '@/lib/auth';
import { lastSeenText } from '@/lib/kid';
import { POOL_NAMES } from '@/lib/today';
import { cn } from '@/lib/utils';
import { useDevices } from '@/pages/kids';
import { useToday } from '@/pages/today';

const ICONS = { phone: Smartphone, tablet: Tablet, pc: Monitor };

export const DURATIONS: { value: ParentModeDuration; label: string }[] = [
  { value: 2, label: '2 min' },
  { value: 5, label: '5 min' },
  { value: 15, label: '15 min' },
  { value: 60, label: '1 hour' },
  { value: null, label: 'Until I end it' },
];

function messageOf(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong. Try again.';
}

function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-sm text-danger">
      {messageOf(error)}
    </p>
  );
}

type Action = { kind: 'rename' | 'parentMode' | 'remove'; device: Device };

/** "Parent mode · 10 min" or "Parent mode · until ended". */
function parentModeText(parentMode: NonNullable<TodayDevice['parentMode']>, now: Date): string {
  if (!parentMode.endsAt) return 'Parent mode · until ended';
  const minutes = Math.max(1, Math.ceil((new Date(parentMode.endsAt).getTime() - now.getTime()) / 60_000));
  return `Parent mode · ${minutes} min`;
}

function RenameBody({ device, onDone }: { device: Device; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(device.name);
  const rename = useMutation({
    mutationFn: () => api.patch<Device>(`/v1/devices/${device.id}`, { name: name.trim() }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['devices'] });
      void queryClient.invalidateQueries({ queryKey: ['today'] });
      onDone();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) rename.mutate();
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <DialogTitle>Rename {device.name}</DialogTitle>
      <div className="flex flex-col gap-2">
        <Label htmlFor="device-name">Name</Label>
        <Input id="device-name" value={name} maxLength={40} autoComplete="off" onChange={(e) => setName(e.target.value)} />
      </div>
      <ErrorText error={rename.error} />
      <Button type="submit" disabled={rename.isPending || !name.trim()}>
        {rename.isPending && <Loader2 className="animate-spin" />}
        Save
      </Button>
    </form>
  );
}

function ParentModeBody({ device, onDone }: { device: Device; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [duration, setDuration] = useState<ParentModeDuration>(15);
  const start = useMutation({
    mutationFn: () => api.post(`/v1/devices/${device.id}/parent-mode`, { durationMin: duration }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['today'] });
      onDone();
    },
  });
  return (
    <>
      <DialogTitle>Parent mode on {device.name}</DialogTitle>
      <DialogDescription>
        {device.name} unlocks for a parent to use. Time in parent mode does not count, and the other parents are told.
      </DialogDescription>
      <div role="radiogroup" aria-label="How long" className="flex flex-wrap gap-2">
        {DURATIONS.map((d) => (
          <button
            key={d.label}
            type="button"
            role="radio"
            aria-checked={duration === d.value}
            onClick={() => setDuration(d.value)}
            className={cn(
              'h-10 rounded-full border border-outline px-4 text-sm font-medium transition-colors hover:bg-surface-variant',
              duration === d.value && 'border-primary bg-primary/10 text-primary',
            )}
          >
            {d.label}
          </button>
        ))}
      </div>
      <ErrorText error={start.error} />
      <Button disabled={start.isPending} onClick={() => start.mutate()}>
        {start.isPending ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
        Start parent mode
      </Button>
    </>
  );
}

function RemoveBody({ device, onDone }: { device: Device; onDone: () => void }) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => api.delete(`/v1/devices/${device.id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['devices'] });
      void queryClient.invalidateQueries({ queryKey: ['today'] });
      onDone();
    },
  });
  return (
    <>
      <DialogTitle>Remove {device.name}?</DialogTitle>
      <DialogDescription>
        It is signed out of ScreenTime and stops limiting time. To add it again you need a new code.
      </DialogDescription>
      <ErrorText error={remove.error} />
      <div className="grid grid-cols-2 gap-3">
        <Button variant="outline" disabled={remove.isPending} onClick={onDone}>
          Cancel
        </Button>
        <Button variant="danger" disabled={remove.isPending} onClick={() => remove.mutate()}>
          {remove.isPending ? <Loader2 className="animate-spin" /> : <Trash2 />}
          Remove
        </Button>
      </div>
    </>
  );
}

function DeviceRow({
  device,
  live,
  now,
  onAction,
}: {
  device: Device;
  live: TodayDevice | undefined;
  now: Date;
  onAction: (action: Action) => void;
}) {
  const queryClient = useQueryClient();
  const end = useMutation({
    mutationFn: () => api.delete(`/v1/devices/${device.id}/parent-mode`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['today'] }),
  });
  const Icon = ICONS[device.form];
  const parentMode = live?.parentMode ?? null;
  // The model is left out while it is still the name (a device's first name is its model).
  const model = device.model && !device.name.includes(device.model) ? device.model : null;
  const facts = [`${POOL_NAMES[device.pool]} time`, model, device.osVersion].filter(Boolean).join(' · ');

  return (
    <div className="flex items-center gap-4 border-t border-outline py-4 last:pb-0">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface-variant text-muted">
        <Icon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{device.name}</p>
        <p className="truncate text-sm text-muted">{facts}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
          {live?.inUse ? (
            <span className="rounded-full bg-primary/10 px-2.5 py-0.5 font-medium text-primary">In use now</span>
          ) : (
            <span className="text-muted">{lastSeenText(device.lastSeenAt, now)}</span>
          )}
          {parentMode && (
            <span className="rounded-full bg-surface-variant px-2.5 py-0.5 font-medium text-muted">
              {parentModeText(parentMode, now)}
            </span>
          )}
        </div>
        {end.error && <p className="mt-1 text-xs text-danger">{messageOf(end.error)}</p>}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`More for ${device.name}`}>
            {end.isPending ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {parentMode ? (
            <DropdownMenuItem onSelect={() => end.mutate()}>
              <ShieldOff />
              End parent mode
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => onAction({ kind: 'parentMode', device })}>
              <ShieldCheck />
              Parent mode…
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => onAction({ kind: 'rename', device })}>
            <Pencil />
            Rename…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem danger onSelect={() => onAction({ kind: 'remove', device })}>
            <Trash2 />
            Remove device…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** docs/SPEC.md §16.4 devices: name, form icon, last seen, Parent mode, rename, remove, and Add device. */
export function DevicesPanel({ kidId, kidName }: { kidId: string; kidName: string }) {
  const devices = useDevices();
  const today = useToday();
  const [action, setAction] = useState<Action | null>(null);
  const [adding, setAdding] = useState(false);
  const now = today.data ? new Date(today.data.serverTime) : new Date();
  const live = new Map<string, TodayDevice>();
  for (const pool of today.data?.kids.find((k) => k.id === kidId)?.pools ?? []) {
    for (const d of pool.devices) live.set(d.id, d);
  }
  const mine = devices.data?.filter((d) => d.kidId === kidId);
  const close = () => setAction(null);

  return (
    <>
      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Devices</h2>
              <p className="text-sm text-muted">Phones count as Phone time. Tablets and PCs share Screens time.</p>
            </div>
            <Button onClick={() => setAdding(true)}>
              <Plus />
              Add device
            </Button>
          </div>
          {devices.isError && !mine ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <p className="text-sm text-danger" role="alert">
                {messageOf(devices.error)}
              </p>
              <Button variant="outline" onClick={() => void devices.refetch()}>
                <RefreshCw />
                Try again
              </Button>
            </div>
          ) : !mine ? (
            <div className="h-24 animate-pulse rounded-xl bg-surface-variant/50" aria-label="Loading" />
          ) : mine.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-xl bg-surface-variant/60 py-8 text-center">
              <Smartphone className="size-6 text-muted" />
              <p className="text-sm text-muted">No devices yet. Add {kidName}'s phone, tablet or PC.</p>
            </div>
          ) : (
            <div>
              {mine.map((device) => (
                <DeviceRow key={device.id} device={device} live={live.get(device.id)} now={now} onAction={setAction} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={action !== null} onOpenChange={(o) => !o && close()}>
        <DialogContent>
          {action?.kind === 'rename' && <RenameBody device={action.device} onDone={close} />}
          {action?.kind === 'parentMode' && <ParentModeBody device={action.device} onDone={close} />}
          {action?.kind === 'remove' && <RemoveBody device={action.device} onDone={close} />}
        </DialogContent>
      </Dialog>
      <AddDeviceDialog
        open={adding}
        kidId={kidId}
        kidName={kidName}
        onClose={() => {
          setAdding(false);
          void today.refetch();
        }}
      />
    </>
  );
}
