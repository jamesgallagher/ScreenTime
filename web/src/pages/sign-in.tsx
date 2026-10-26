import { Navigate } from '@tanstack/react-router';
import { REGEXP_ONLY_DIGITS } from 'input-otp';
import { Loader2 } from 'lucide-react';
import { type FormEvent, useRef, useState } from 'react';
import { Brand } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';
import { api, useAuth } from '@/lib/auth';

function messageOf(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong. Try again.';
}

/** docs/SPEC.md §11.1 and §16.5: email, then the 6-digit code from the email. */
export function SignInPage() {
  const auth = useAuth();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const codeInput = useRef<HTMLInputElement>(null);

  // A super admin with no family has only the Admin page.
  if (auth.status === 'signedIn') return <Navigate to={auth.me.family ? '/' : '/admin'} />;

  async function sendCode(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.requestCode(email.trim());
      setCode('');
      setStep('code');
      if (step === 'code') {
        setNotice('We sent a new code.');
        codeInput.current?.focus();
      }
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function verify(value: string) {
    if (value.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.verifyCode(email.trim(), value);
    } catch (err) {
      setError(messageOf(err));
      setCode('');
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 px-4 py-10">
      <Brand />
      <Card className="w-full max-w-sm">
        {step === 'email' ? (
          <>
            <CardHeader>
              <CardTitle>Sign in</CardTitle>
              <CardDescription>We'll email you a 6-digit code.</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="flex flex-col gap-4" onSubmit={sendCode}>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    autoFocus
                    required
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    aria-invalid={error ? true : undefined}
                  />
                </div>
                {error && (
                  <p role="alert" className="text-sm text-danger">
                    {error}
                  </p>
                )}
                <Button type="submit" disabled={busy || email.trim() === ''}>
                  {busy && <Loader2 className="animate-spin" />}
                  Send code
                </Button>
              </form>
            </CardContent>
          </>
        ) : (
          <>
            <CardHeader>
              <CardTitle>Check your email</CardTitle>
              <CardDescription>
                Enter the 6-digit code we sent to <span className="font-medium text-on-surface">{email.trim()}</span>.
                It works for 10 minutes.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <InputOTP
                ref={codeInput}
                maxLength={6}
                pattern={REGEXP_ONLY_DIGITS}
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                value={code}
                onChange={setCode}
                onComplete={(value: string) => void verify(value)}
                aria-label="Sign-in code"
                containerClassName="justify-center"
              >
                <InputOTPGroup>
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <InputOTPSlot key={i} index={i} />
                  ))}
                </InputOTPGroup>
              </InputOTP>
              {error && (
                <p role="alert" className="text-center text-sm text-danger">
                  {error}
                </p>
              )}
              {notice && <p className="text-center text-sm text-muted">{notice}</p>}
              <Button disabled={busy || code.length !== 6} onClick={() => void verify(code)}>
                {busy && <Loader2 className="animate-spin" />}
                Sign in
              </Button>
              <div className="flex items-center justify-between text-sm">
                <Button
                  variant="link"
                  disabled={busy}
                  onClick={() => {
                    setStep('email');
                    setError(null);
                    setNotice(null);
                  }}
                >
                  Use a different email
                </Button>
                <Button variant="link" disabled={busy} onClick={() => void sendCode()}>
                  Send a new code
                </Button>
              </div>
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
}
