import { Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

/** The app mark: a clock on a teal rounded square, then the name. */
export function Brand({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-on-primary">
        <Clock className="size-5" strokeWidth={2.5} />
      </span>
      <span className="text-lg font-semibold tracking-tight">ScreenTime</span>
    </div>
  );
}
