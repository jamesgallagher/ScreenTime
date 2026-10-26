import { cn } from '@/lib/utils';

/** A circle in the kid's colour with the first letter of their name (docs/SPEC.md §16.4). */
export function KidAvatar({ name, color, className }: { name: string; color: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('flex size-10 shrink-0 items-center justify-center rounded-full text-base font-semibold text-white', className)}
      style={{ backgroundColor: color }}
    >
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}
