import type { Sos } from '@screentime/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, MapPin, Siren } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ApiError } from '@/lib/api';
import { api, useAuth } from '@/lib/auth';
import { formatTimeOfDay } from '@/lib/format';
import { mapUrl } from '@/lib/inbox';

/** Active SOS alerts, checked every 15 seconds on every page (docs/SPEC.md §16.5). */
export function useActiveSos(enabled = true) {
  return useQuery({
    queryKey: ['sos', 'active'],
    queryFn: () => api.get<Sos[]>('/v1/sos?active=true'),
    refetchInterval: 15_000,
    enabled,
  });
}

function messageOf(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong. Try again.';
}

// The light theme's danger red in both themes: the dark theme's lighter red is too pale for white text.
const RED = '#DC2626';

function SosAlert({ sos, parentId, timeZone }: { sos: Sos; parentId: string | null; timeZone: string }) {
  const queryClient = useQueryClient();
  const [confirmEnd, setConfirmEnd] = useState(false);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['sos'] });
    void queryClient.invalidateQueries({ queryKey: ['events'] });
  };
  const ack = useMutation({ mutationFn: () => api.post<Sos>(`/v1/sos/${sos.id}/ack`), onSuccess: refresh });
  const end = useMutation({
    mutationFn: () => api.post<Sos>(`/v1/sos/${sos.id}/end`),
    onSuccess: () => {
      setConfirmEnd(false);
      refresh();
    },
  });
  const mine = sos.acks.some((a) => a.parentId === parentId);
  const location = sos.lastLocation;
  const facts = [
    `Started ${formatTimeOfDay(sos.startedAt, timeZone)} on ${sos.deviceName}`,
    location ? `Last position ${formatTimeOfDay(location.at, timeZone)}` : 'No position yet',
    location?.batteryPct != null ? `Battery ${location.batteryPct}%` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const onIt = sos.acks.map((a) => a.byName).join(' and ');

  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-2xl p-4 text-white shadow-lg sm:flex-row sm:items-center"
      style={{ backgroundColor: RED }}
    >
      <span className="flex size-11 shrink-0 animate-pulse items-center justify-center rounded-full bg-white/20">
        <Siren className="size-6" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-lg font-semibold">SOS from {sos.kidName}</p>
        <p className="text-sm text-white/90">{facts}</p>
        {onIt && <p className="mt-1 text-sm font-medium">{onIt} on it</p>}
        {(ack.error || end.error) && <p className="mt-1 text-sm font-medium">{messageOf(ack.error ?? end.error)}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        {location && (
          <Button asChild variant="outline" size="sm" className="border-white/40 bg-white hover:bg-white/90"
            style={{ color: RED }}>
            <a href={mapUrl(location)} target="_blank" rel="noreferrer">
              <MapPin />
              Open map
            </a>
          </Button>
        )}
        {mine ? (
          <span className="inline-flex h-9 items-center gap-1.5 px-2 text-sm font-medium">
            <Check className="size-4" />
            You're on it
          </span>
        ) : (
          <Button
            size="sm"
            className="bg-white hover:bg-white/90"
            style={{ color: RED }}
            disabled={ack.isPending}
            onClick={() => ack.mutate()}
          >
            {ack.isPending && <Loader2 className="animate-spin" />}
            I'm on it
          </Button>
        )}
        <Button size="sm" variant="ghost" className="text-white hover:bg-white/15" onClick={() => setConfirmEnd(true)}>
          End SOS
        </Button>
      </div>
      <Dialog open={confirmEnd} onOpenChange={(o) => !o && setConfirmEnd(false)}>
        <DialogContent>
          <DialogTitle>End {sos.kidName}'s SOS?</DialogTitle>
          <DialogDescription>
            Only end it when you know {sos.kidName} is safe. Their phone stops sharing its position, and the other parents
            are told.
          </DialogDescription>
          {end.error && (
            <p role="alert" className="text-sm text-danger">
              {messageOf(end.error)}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Button variant="outline" disabled={end.isPending} onClick={() => setConfirmEnd(false)}>
              Cancel
            </Button>
            <Button variant="danger" disabled={end.isPending} onClick={() => end.mutate()}>
              {end.isPending && <Loader2 className="animate-spin" />}
              End SOS
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** A red banner at the top of every page while an SOS is active, with the map link (docs/SPEC.md §15, §16.5). */
export function SosBanner() {
  const auth = useAuth();
  const me = auth.status === 'signedIn' ? auth.me : null;
  // A super admin without a family has no SOS to see.
  const sos = useActiveSos(Boolean(me?.family));
  if (!me?.family || !sos.data?.length) return null;
  const timeZone = me.family.timezone;
  return (
    <div className="mb-6 flex flex-col gap-3">
      {sos.data.map((s) => (
        <SosAlert key={s.id} sos={s} parentId={me.parent?.id ?? null} timeZone={timeZone} />
      ))}
    </div>
  );
}
