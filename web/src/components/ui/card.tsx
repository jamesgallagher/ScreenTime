import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** A surface with a 16 px radius (docs/SPEC.md §16.1). */
export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div data-slot="card" className={cn('rounded-2xl border border-outline bg-surface shadow-sm', className)} {...props} />
  );
}

export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-header" className={cn('flex flex-col gap-1.5 p-6 pb-0', className)} {...props} />;
}

export function CardTitle({ className, ...props }: ComponentProps<'h2'>) {
  return <h2 data-slot="card-title" className={cn('text-lg font-semibold', className)} {...props} />;
}

export function CardDescription({ className, ...props }: ComponentProps<'p'>) {
  return <p data-slot="card-description" className={cn('text-sm text-muted', className)} {...props} />;
}

export function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-content" className={cn('p-6', className)} {...props} />;
}
