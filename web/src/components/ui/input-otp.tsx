import { OTPInput, OTPInputContext } from 'input-otp';
import { type ComponentProps, useContext } from 'react';
import { cn } from '@/lib/utils';

/** shadcn/ui one-time-code input: one box per digit. */
export function InputOTP({ className, containerClassName, ...props }: ComponentProps<typeof OTPInput>) {
  return (
    <OTPInput
      data-slot="input-otp"
      containerClassName={cn('flex items-center has-disabled:opacity-50', containerClassName)}
      className={cn('disabled:cursor-not-allowed', className)}
      {...props}
    />
  );
}

export function InputOTPGroup({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="input-otp-group" className={cn('flex items-center gap-2', className)} {...props} />;
}

export function InputOTPSlot({ index, className, ...props }: ComponentProps<'div'> & { index: number }) {
  const slot = useContext(OTPInputContext)?.slots[index];
  return (
    <div
      data-slot="input-otp-slot"
      data-active={slot?.isActive ?? false}
      className={cn(
        'relative flex h-12 w-10 items-center justify-center rounded-xl border border-outline bg-surface text-xl font-semibold tabular-nums transition-colors sm:h-14 sm:w-12 sm:text-2xl data-[active=true]:border-primary data-[active=true]:ring-2 data-[active=true]:ring-primary/30',
        className,
      )}
      {...props}
    >
      {slot?.char}
      {slot?.hasFakeCaret && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-6 w-px animate-pulse bg-on-surface" />
        </div>
      )}
    </div>
  );
}
