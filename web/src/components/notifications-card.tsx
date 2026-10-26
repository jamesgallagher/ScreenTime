import type { NotificationKind, NotificationPref } from '@screentime/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { ApiError } from '@/lib/api';
import { api } from '@/lib/auth';
import { NOTIFICATION_TEXT } from '@/lib/settings';

function messageOf(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong. Try again.';
}

/**
 * docs/SPEC.md §13: which alerts this parent's phone gets. SOS and requests that wait for an answer are
 * always on. Each switch saves at once.
 */
export function NotificationsCard() {
  const queryClient = useQueryClient();
  const prefs = useQuery({
    queryKey: ['notification-prefs'],
    queryFn: () => api.get<NotificationPref[]>('/v1/me/notification-prefs'),
  });
  const save = useMutation({
    mutationFn: (change: { kind: NotificationKind; enabled: boolean }) =>
      api.put<NotificationPref[]>('/v1/me/notification-prefs', [change]),
    onSuccess: (result) => queryClient.setQueryData(['notification-prefs'], result),
  });

  // Always-on kinds first, then the server's order (the sort is stable).
  const sorted = [...(prefs.data ?? [])].sort((a, b) => Number(b.essential) - Number(a.essential));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
        <CardDescription>
          Alerts on your phone from the ScreenTime parent app. These are yours only. The Inbox always shows everything.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {prefs.isError && !prefs.data ? (
          <div className="flex flex-col items-start gap-3">
            <p role="alert" className="text-sm text-danger">
              {messageOf(prefs.error)}
            </p>
            <Button variant="outline" size="sm" onClick={() => void prefs.refetch()}>
              <RefreshCw />
              Try again
            </Button>
          </div>
        ) : !prefs.data ? (
          <div className="h-64 animate-pulse rounded-xl bg-surface-variant/50" aria-label="Loading" />
        ) : (
          <ul className="flex flex-col">
            {sorted.map((pref) => {
              const text = NOTIFICATION_TEXT[pref.kind] ?? { title: pref.kind, detail: '' };
              const pending = save.isPending && save.variables?.kind === pref.kind;
              const checked = pending ? (save.variables?.enabled ?? pref.enabled) : pref.enabled;
              const id = `notify-${pref.kind}`;
              return (
                <li key={pref.kind} className="flex items-center gap-4 border-t border-outline py-3 first:border-t-0 first:pt-0">
                  <div className="min-w-0 flex-1">
                    <label htmlFor={pref.essential ? undefined : id} className="font-medium">
                      {text.title}
                    </label>
                    <p className="text-sm text-muted">{text.detail}</p>
                  </div>
                  {pref.essential ? (
                    <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted">
                      <Lock className="size-3.5" />
                      Always on
                    </span>
                  ) : (
                    <Switch
                      id={id}
                      checked={checked}
                      disabled={pending}
                      onCheckedChange={(enabled) => save.mutate({ kind: pref.kind, enabled })}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {save.error && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {messageOf(save.error)}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
