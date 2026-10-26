import type { EventItem, EventPage, ParentModeDuration, TimeRequest } from '@screentime/schemas';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Hand, Info, Loader2, MessageCircle, Minus, Plus, RefreshCw, ShieldAlert, ShieldCheck, Siren } from 'lucide-react';
import { useState } from 'react';
import { DURATIONS } from '@/components/devices-panel';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ApiError } from '@/lib/api';
import { api, useAuth } from '@/lib/auth';
import { formatDuration } from '@/lib/format';
import { type EventTone, eventView, pendingParentModeRequests, whenText } from '@/lib/inbox';
import { POOL_NAMES } from '@/lib/today';
import { cn } from '@/lib/utils';

const PAGE = 50;
const APPROVE_MIN = 15;
const APPROVE_MAX = 480;
const QUICK = [15, 30, 60, 120];

function messageOf(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong. Try again.';
}

/** The event history, newest first, 50 at a time; refreshed every 30 seconds (docs/SPEC.md §13). */
function useEvents() {
  return useInfiniteQuery({
    queryKey: ['events'],
    queryFn: ({ pageParam }) =>
      api.get<EventPage>(`/v1/events?limit=${PAGE}${pageParam ? `&before=${pageParam}` : ''}`),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextBefore,
    refetchInterval: 30_000,
  });
}

function usePendingRequests() {
  return useQuery({
    queryKey: ['requests', 'pending'],
    queryFn: () => api.get<TimeRequest[]>('/v1/requests?status=pending'),
    refetchInterval: 30_000,
  });
}

/** After an answer: the request list, the history and Today all change. */
function useRefreshAll() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['requests'] });
    void queryClient.invalidateQueries({ queryKey: ['events'] });
    void queryClient.invalidateQueries({ queryKey: ['today'] });
  };
}

const TONE: Record<EventTone, { icon: typeof Info; className: string }> = {
  sos: { icon: Siren, className: 'bg-danger/10 text-danger' },
  alert: { icon: ShieldAlert, className: 'bg-warning/15 text-warning' },
  request: { icon: Hand, className: 'bg-primary/10 text-primary' },
  message: { icon: MessageCircle, className: 'bg-primary/10 text-primary' },
  time: { icon: Clock, className: 'bg-surface-variant text-muted' },
  info: { icon: Info, className: 'bg-surface-variant text-muted' },
};

function ToneIcon({ tone }: { tone: EventTone }) {
  const { icon: Icon, className } = TONE[tone];
  return (
    <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-full', className)}>
      <Icon className="size-5" />
    </span>
  );
}

function ApproveBody({ request, onDone }: { request: TimeRequest; onDone: () => void }) {
  const refreshAll = useRefreshAll();
  const [minutes, setMinutes] = useState(request.minutes);
  const approve = useMutation({
    mutationFn: () => api.post<TimeRequest>(`/v1/requests/${request.id}/approve`, { minutes }),
    onSuccess: () => {
      refreshAll();
      onDone();
    },
  });
  const step = (delta: number) => setMinutes((m) => Math.min(APPROVE_MAX, Math.max(APPROVE_MIN, m + delta)));
  return (
    <>
      <DialogTitle>
        Give {request.kidName} more {POOL_NAMES[request.pool]}
      </DialogTitle>
      <DialogDescription>
        {request.kidName} asked for {formatDuration(request.minutes * 60)}. It counts for today only.
      </DialogDescription>
      <div className="flex items-center justify-between gap-4">
        <Button variant="outline" size="icon" aria-label="15 minutes less" disabled={minutes <= APPROVE_MIN} onClick={() => step(-15)}>
          <Minus />
        </Button>
        <p className="text-4xl font-semibold tabular-nums" aria-live="polite" data-testid="approve-value">
          {formatDuration(minutes * 60)}
        </p>
        <Button variant="outline" size="icon" aria-label="15 minutes more" disabled={minutes >= APPROVE_MAX} onClick={() => step(15)}>
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
            {formatDuration(q * 60)}
          </button>
        ))}
      </div>
      {approve.error && (
        <p role="alert" className="text-center text-sm text-danger">
          {messageOf(approve.error)}
        </p>
      )}
      <Button disabled={approve.isPending} onClick={() => approve.mutate()}>
        {approve.isPending && <Loader2 className="animate-spin" />}
        Give {formatDuration(minutes * 60)}
      </Button>
    </>
  );
}

function TimeRequestCard({ request, timeZone, now }: { request: TimeRequest; timeZone: string; now: Date }) {
  const refreshAll = useRefreshAll();
  const [choosing, setChoosing] = useState(false);
  const approve = useMutation({
    mutationFn: () => api.post<TimeRequest>(`/v1/requests/${request.id}/approve`, {}),
    onSuccess: refreshAll,
  });
  const deny = useMutation({ mutationFn: () => api.post<TimeRequest>(`/v1/requests/${request.id}/deny`), onSuccess: refreshAll });
  const busy = approve.isPending || deny.isPending;
  const error = approve.error ?? deny.error;
  const asked = formatDuration(request.minutes * 60);
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 gap-3">
          <ToneIcon tone="request" />
          <div className="min-w-0">
            <p className="font-semibold">
              {request.kidName} wants {asked} more {POOL_NAMES[request.pool]}
            </p>
            {request.reason && <p className="text-sm">“{request.reason}”</p>}
            <p className="text-xs text-muted">
              {request.deviceName} · {whenText(request.createdAt, now, timeZone)}
            </p>
            {error && <p className="mt-1 text-sm text-danger">{messageOf(error)}</p>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="link" size="sm" disabled={busy} onClick={() => setChoosing(true)}>
            Other amount
          </Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => deny.mutate()}>
            {deny.isPending && <Loader2 className="animate-spin" />}
            No
          </Button>
          <Button size="sm" disabled={busy} onClick={() => approve.mutate()}>
            {approve.isPending && <Loader2 className="animate-spin" />}
            Yes, {asked}
          </Button>
        </div>
      </CardContent>
      <Dialog open={choosing} onOpenChange={(o) => !o && setChoosing(false)}>
        <DialogContent>{choosing && <ApproveBody request={request} onDone={() => setChoosing(false)} />}</DialogContent>
      </Dialog>
    </Card>
  );
}

function ParentModeCard({ event, timeZone, now }: { event: EventItem; timeZone: string; now: Date }) {
  const refreshAll = useRefreshAll();
  const [duration, setDuration] = useState<ParentModeDuration>(15);
  const requestId = String(event.payload.requestId);
  const approve = useMutation({
    mutationFn: () => api.post(`/v1/parent-mode-requests/${requestId}/approve`, { durationMin: duration }),
    onSuccess: refreshAll,
  });
  const deny = useMutation({ mutationFn: () => api.post(`/v1/parent-mode-requests/${requestId}/deny`), onSuccess: refreshAll });
  const busy = approve.isPending || deny.isPending;
  const error = approve.error ?? deny.error;
  const device = event.deviceName ?? 'the device';
  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex gap-3">
          <ToneIcon tone="request" />
          <div className="min-w-0">
            <p className="font-semibold">
              {event.kidName ?? 'A kid'} asks for parent mode on {device}
            </p>
            <p className="text-sm text-muted">
              Someone pressed “I'm the parent” on {device}. Say yes only if a parent is there with it.
            </p>
            <p className="text-xs text-muted">{whenText(event.at, now, timeZone)}</p>
            {error && <p className="mt-1 text-sm text-danger">{messageOf(error)}</p>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label="How long" className="mr-auto flex flex-wrap gap-2">
            {DURATIONS.map((d) => (
              <button
                key={d.label}
                type="button"
                role="radio"
                aria-checked={duration === d.value}
                onClick={() => setDuration(d.value)}
                className={cn(
                  'h-9 rounded-full border border-outline px-3 text-sm font-medium transition-colors hover:bg-surface-variant',
                  duration === d.value && 'border-primary bg-primary/10 text-primary',
                )}
              >
                {d.label}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => deny.mutate()}>
            {deny.isPending && <Loader2 className="animate-spin" />}
            No
          </Button>
          <Button size="sm" disabled={busy} onClick={() => approve.mutate()}>
            {approve.isPending ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
            Start parent mode
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function EventRow({ event, timeZone, now }: { event: EventItem; timeZone: string; now: Date }) {
  const view = eventView(event, timeZone);
  return (
    <li className="flex gap-3 border-t border-outline py-3 first:border-t-0 first:pt-0 last:pb-0">
      <ToneIcon tone={view.tone} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{view.text}</p>
        {view.detail && <p className="text-sm text-muted">{view.detail}</p>}
      </div>
      <time dateTime={event.at} className="shrink-0 pt-0.5 text-xs text-muted tabular-nums">
        {whenText(event.at, now, timeZone)}
      </time>
    </li>
  );
}

/** docs/SPEC.md §16.4 and §16.5 Inbox: what waits for an answer at the top, then every event, newest first. */
export function InboxPage() {
  const auth = useAuth();
  const timeZone = (auth.status === 'signedIn' && auth.me.family?.timezone) || 'UTC';
  const events = useEvents();
  const requests = usePendingRequests();
  const now = new Date();
  const all = events.data?.pages.flatMap((p) => p.events) ?? [];
  const parentMode = pendingParentModeRequests(all, now);
  const waiting = (requests.data?.length ?? 0) + parentMode.length;

  return (
    <>
      <PageHeader title="Inbox" description="Requests, messages and everything that happened." />
      {waiting > 0 && (
        <section aria-labelledby="waiting" className="mb-8 flex flex-col gap-3">
          <h2 id="waiting" className="text-sm font-semibold text-muted">
            Waiting for you
          </h2>
          {parentMode.map((e) => (
            <ParentModeCard key={e.id} event={e} timeZone={timeZone} now={now} />
          ))}
          {requests.data?.map((r) => (
            <TimeRequestCard key={r.id} request={r} timeZone={timeZone} now={now} />
          ))}
        </section>
      )}
      <section aria-labelledby="history" className="flex flex-col gap-3">
        <h2 id="history" className="text-sm font-semibold text-muted">
          History
        </h2>
        {events.isError && !events.data ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
              <p className="text-sm text-danger" role="alert">
                {messageOf(events.error)}
              </p>
              <Button variant="outline" onClick={() => void events.refetch()}>
                <RefreshCw />
                Try again
              </Button>
            </CardContent>
          </Card>
        ) : !events.data ? (
          <Card className="h-64 animate-pulse bg-surface-variant/50" aria-label="Loading" />
        ) : all.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
              <span className="flex size-12 items-center justify-center rounded-full bg-surface-variant text-muted">
                <MessageCircle className="size-6" />
              </span>
              <p className="font-medium">Nothing yet</p>
              <p className="max-w-sm text-sm text-muted">Requests, messages and changes to time show up here.</p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent>
              <ul>
                {all.map((e) => (
                  <EventRow key={e.id} event={e} timeZone={timeZone} now={now} />
                ))}
              </ul>
              {events.hasNextPage && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4 w-full"
                  disabled={events.isFetchingNextPage}
                  onClick={() => void events.fetchNextPage()}
                >
                  {events.isFetchingNextPage && <Loader2 className="animate-spin" />}
                  Show older
                </Button>
              )}
            </CardContent>
          </Card>
        )}
      </section>
    </>
  );
}
