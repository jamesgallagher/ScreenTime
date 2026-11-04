import { useQuery } from '@tanstack/react-query';
import { AppWindow, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { fetchKidApps, firstUsedLine, installedLine, isRemoved, type KidApp, sortApps, todayLine } from '@/lib/apps';
import { useAuth } from '@/lib/auth';

function AppRow({ app, timeZone }: { app: KidApp; timeZone: string }) {
  const removed = isRemoved(app);
  const today = todayLine(app);
  return (
    <li className="flex items-center gap-3 border-t border-outline py-3 first:border-t-0 first:pt-0 last:pb-0">
      <span
        aria-hidden
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-variant font-semibold text-muted"
      >
        {app.label.charAt(0).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <p className={removed ? 'truncate font-medium text-muted' : 'truncate font-medium'}>{app.label}</p>
        <p className="text-sm text-muted">{installedLine(app, timeZone)}</p>
        <p className="text-sm text-muted">{firstUsedLine(app, timeZone)}</p>
      </div>
      {removed ? (
        <span className="shrink-0 rounded-full bg-surface-variant px-2.5 py-1 text-xs font-medium text-muted">Removed</span>
      ) : (
        today && <span className="shrink-0 text-sm font-medium tabular-nums">{today}</span>
      )}
    </li>
  );
}

/** docs/SPEC.md §12.4 and §16.5: what is on the kid's Android devices, what is new and what has been used. */
export function AppsPanel({ kidId, kidName }: { kidId: string; kidName: string }) {
  const auth = useAuth();
  const timeZone = (auth.status === 'signedIn' && auth.me.family?.timezone) || 'UTC';
  const apps = useQuery({ queryKey: ['kid-apps', kidId], queryFn: () => fetchKidApps(kidId) });

  if (!apps.data) {
    return apps.isError ? (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <p className="text-sm text-danger" role="alert">
            {apps.error instanceof ApiError ? apps.error.message : 'Something went wrong. Try again.'}
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
              <AppRow key={app.package} app={app} timeZone={timeZone} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
