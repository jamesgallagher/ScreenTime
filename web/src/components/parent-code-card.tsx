import type { ParentCodeSecret } from '@screentime/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, KeyRound, Loader2, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ApiError } from '@/lib/api';
import { api } from '@/lib/auth';
import { spacedCode } from '@/lib/kid';
import { STEP_SEC, secondsLeft, totp } from '@/lib/totp';

function messageOf(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong. Try again.';
}

const RADIUS = 18;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** A ring that empties as the code's 30 seconds run out, with the seconds in the middle. */
function CountdownRing({ left }: { left: number }) {
  return (
    <span className="relative flex size-11 shrink-0 items-center justify-center" aria-hidden>
      <svg viewBox="0 0 44 44" className="absolute inset-0 -rotate-90">
        <circle cx="22" cy="22" r={RADIUS} fill="none" strokeWidth="4" className="stroke-surface-variant" />
        <circle
          cx="22"
          cy="22"
          r={RADIUS}
          fill="none"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - left / STEP_SEC)}
          className={left <= 5 ? 'stroke-warning' : 'stroke-primary'}
        />
      </svg>
      <span className="text-xs font-semibold tabular-nums">{left}</span>
    </span>
  );
}

/** The code of the current 30-second step, worked out in the browser. Null until the first one is ready. */
function useParentCode(secret: string | undefined): { code: string | null; left: number } {
  const [now, setNow] = useState(() => Date.now());
  const [result, setResult] = useState<{ key: string; code: string } | null>(null);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const step = Math.floor(now / 1000 / STEP_SEC);
  const key = `${secret ?? ''}:${step}`;
  useEffect(() => {
    if (!secret) return;
    let live = true;
    void totp(secret, step * STEP_SEC * 1000).then((code) => {
      if (live) setResult({ key, code });
    });
    return () => {
      live = false;
    };
  }, [secret, step, key]);
  return { code: result?.key === key ? result.code : null, left: secondsLeft(now) };
}

/**
 * docs/SPEC.md §12.3: when a kid device is offline, a parent types this code on it to start parent mode.
 * Hidden until asked for, so a kid looking at the screen does not see it.
 */
export function ParentCodeCard() {
  const queryClient = useQueryClient();
  const secret = useQuery({
    queryKey: ['parent-code'],
    queryFn: () => api.get<ParentCodeSecret>('/v1/family/parent-code'),
    staleTime: Infinity,
  });
  const [shown, setShown] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const { code, left } = useParentCode(shown ? secret.data?.secret : undefined);
  const rotate = useMutation({
    mutationFn: () => api.post<ParentCodeSecret>('/v1/family/parent-code/rotate'),
    onSuccess: (next) => {
      queryClient.setQueryData(['parent-code'], next);
      setConfirm(false);
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Parent code</CardTitle>
        <CardDescription>
          When a kid's device is offline, type this code on it to start parent mode. It changes every 30 seconds.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {secret.isError ? (
          <div className="flex flex-col items-start gap-3">
            <p role="alert" className="text-sm text-danger">
              {messageOf(secret.error)}
            </p>
            <Button variant="outline" size="sm" onClick={() => void secret.refetch()}>
              <RefreshCw />
              Try again
            </Button>
          </div>
        ) : !shown ? (
          <Button variant="outline" className="self-start" disabled={!secret.data} onClick={() => setShown(true)}>
            <Eye />
            Show code
          </Button>
        ) : (
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-4 rounded-2xl bg-surface-variant px-5 py-3">
              <p
                aria-live="polite"
                aria-label={code ? `Parent code ${code.split('').join(' ')}` : 'Working out the code'}
                className="font-mono text-3xl font-semibold tracking-widest tabular-nums"
              >
                {code ? spacedCode(code) : '··· ···'}
              </p>
              <CountdownRing left={left} />
            </div>
            <Button variant="ghost" size="sm" onClick={() => setShown(false)}>
              <EyeOff />
              Hide
            </Button>
          </div>
        )}
        <div className="border-t border-outline pt-4">
          <Button variant="link" size="sm" className="text-muted" disabled={!secret.data} onClick={() => setConfirm(true)}>
            <KeyRound />
            Make a new code…
          </Button>
        </div>
      </CardContent>

      <Dialog open={confirm} onOpenChange={(o) => !o && setConfirm(false)}>
        <DialogContent>
          <DialogTitle>Make a new parent code?</DialogTitle>
          <DialogDescription>
            Do this if a kid has seen how the code works, or a parent's phone was lost. The old codes stop working on
            each device the next time it is online.
          </DialogDescription>
          {rotate.error && (
            <p role="alert" className="text-sm text-danger">
              {messageOf(rotate.error)}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Button variant="outline" disabled={rotate.isPending} onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button disabled={rotate.isPending} onClick={() => rotate.mutate()}>
              {rotate.isPending && <Loader2 className="animate-spin" />}
              Make new code
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
