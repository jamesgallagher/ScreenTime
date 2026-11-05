import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppWindow, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { ApiError } from '@/lib/api';
import {
  APP_RULES_READY,
  type AppChoice,
  appChoice,
  fetchKidApps,
  firstUsedLine,
  installedLine,
  isRemoved,
  type KidApp,
  saveAppRule,
  saveNewAppApproval,
  sortApps,
  todayLine,
} from '@/lib/apps';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';

function messageOf(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong. Try again.';
}

const MODES: { value: 'allowed' | 'blocked'; label: string }[] = [
  { value: 'allowed', label: 'Allowed' },
  { value: 'blocked', label: 'Blocked' },
];

function RuleControl({ app, choice, kidId }: { app: KidApp; choice: AppChoice; kidId: string }) {
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (mode: 'allowed' | 'blocked') => saveAppRule(kidId, app.package, mode),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['kid-apps', kidId] }),
  });
  if (choice === 'fixed') return <p className="text-sm text-muted">Always allowed</p>;
  if (choice === 'waiting') {
    return (
      <div className="flex flex-col items-start gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">Waiting for you</span>
          <Button variant="outline" size="sm" disabled={save.isPending} onClick={() => save.mutate('blocked')}>
            Block
          </Button>
          <Button size="sm" disabled={save.isPending} onClick={() => save.mutate('allowed')}>
            {save.isPending && <Loader2 className="animate-spin" />}
            Allow
          </Button>
        </div>
        {save.error && (
          <p role="alert" className="text-sm text-danger">
            {messageOf(save.error)}
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-2">
      <div role="radiogroup" aria-label={`${app.label}: allowed or blocked`} className="flex gap-2">
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            role="radio"
            aria-checked={choice === m.value}
            disabled={save.isPending}
            onClick={() => choice !== m.value && save.mutate(m.value)}
            className={cn(
              'h-9 rounded-full border border-outline px-3 text-sm font-medium transition-colors outline-none hover:bg-surface-variant focus-visible:ring-2 focus-visible:ring-primary',
              choice === m.value && m.value === 'allowed' && 'border-primary bg-primary/10 text-primary',
              choice === m.value && m.value === 'blocked' && 'border-danger bg-danger/10 text-danger',
            )}
          >
            {m.label}
          </button>
        ))}
      </div>
      {save.error && (
        <p role="alert" className="text-sm text-danger">
          {messageOf(save.error)}
        </p>
      )}
    </div>
  );
}

function AppRow({ app, kidId, timeZone }: { app: KidApp; kidId: string; timeZone: string }) {
  const removed = isRemoved(app);
  const today = todayLine(app);
  return (
    <li className="flex items-start gap-3 border-t border-outline py-3 first:border-t-0 first:pt-0 last:pb-0">
      <span
        aria-hidden
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-variant font-semibold text-muted"
      >
        {app.label.charAt(0).toUpperCase()}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div>
          <p className={removed ? 'truncate font-medium text-muted' : 'truncate font-medium'}>{app.label}</p>
          <p className="text-sm text-muted">{installedLine(app, timeZone)}</p>
          <p className="text-sm text-muted">{firstUsedLine(app, timeZone)}</p>
        </div>
        {APP_RULES_READY && !removed && <RuleControl app={app} choice={appChoice(app)} kidId={kidId} />}
      </div>
      {removed ? (
        <span className="shrink-0 rounded-full bg-surface-variant px-2.5 py-1 text-xs font-medium text-muted">Removed</span>
      ) : (
        today && <span className="shrink-0 text-sm font-medium tabular-nums">{today}</span>
      )}
    </li>
  );
}

/** docs/SPEC.md §12.4 and §16.5: what is on the kid's Android devices, what is new, and what is blocked. */
export function AppsPanel({ kidId, kidName }: { kidId: string; kidName: string }) {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const timeZone = (auth.status === 'signedIn' && auth.me.family?.timezone) || 'UTC';
  const apps = useQuery({ queryKey: ['kid-apps', kidId], queryFn: () => fetchKidApps(kidId) });
  const approval = useMutation({
    mutationFn: (on: boolean) => saveNewAppApproval(kidId, on),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['kid-apps', kidId] }),
  });

  if (!apps.data) {
    return apps.isError ? (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <p className="text-sm text-danger" role="alert">
            {messageOf(apps.error)}
          </p>
          <Button variant="outline" onClick={() => void apps.refetch()}>
            <RefreshCw />
            Try again
          </Button>
        </CardContent>
      </Card>
    ) : (
      <Card className="h-64 animate-pulse bg-surface-variant/50" aria-label="Loading" />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {APP_RULES_READY && (
        <Card>
          <CardContent className="flex items-center gap-4">
            <div className="min-w-0 flex-1">
              <label htmlFor="new-app-approval" className="font-medium">
                New apps need approval
              </label>
              <p className="text-sm text-muted">A new app on {kidName}'s device stays blocked until a parent says yes.</p>
              {approval.error && (
                <p role="alert" className="mt-1 text-sm text-danger">
                  {messageOf(approval.error)}
                </p>
              )}
            </div>
            <Switch
              id="new-app-approval"
              checked={apps.data.newAppApproval}
              disabled={approval.isPending}
              onCheckedChange={(on) => approval.mutate(on)}
            />
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Apps</CardTitle>
          <CardDescription>What's on {kidName}'s Android devices, with the newest installs first.</CardDescription>
        </CardHeader>
        <CardContent>
          {apps.data.apps.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-xl bg-surface-variant/60 py-8 text-center">
              <AppWindow className="size-6 text-muted" />
              <p className="text-sm text-muted">No apps yet. They show up after {kidName}'s device next connects.</p>
            </div>
          ) : (
            <ul>
              {sortApps(apps.data.apps).map((app) => (
                <AppRow key={app.package} app={app} kidId={kidId} timeZone={timeZone} />
              ))}
            </ul>
          )}
          {APP_RULES_READY && apps.data.apps.length > 0 && (
            <p className="mt-4 border-t border-outline pt-4 text-sm text-muted">
              Blocking an app does not block its website. To stop YouTube in a browser, block the browsers too.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
