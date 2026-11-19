import type { DeviceForm } from '@screentime/schemas';
import { Monitor, Smartphone, Tablet } from 'lucide-react';
import { cn } from '@/lib/utils';

const FORM_ICONS = { phone: Smartphone, tablet: Tablet, pc: Monitor };

/**
 * A circle in the kid's colour with the first letter of their name (docs/SPEC.md §16.4), or for a shared device
 * (§12.8) its device's icon instead of a letter.
 */
export function KidAvatar({
  name,
  color,
  form,
  className,
}: {
  name: string;
  color: string;
  /** Set for a shared device: the icon of its device's form. */
  form?: DeviceForm;
  className?: string;
}) {
  const Icon = form ? FORM_ICONS[form] : null;
  return (
    <span
      aria-hidden
      className={cn('flex size-10 shrink-0 items-center justify-center rounded-full text-base font-semibold text-white', className)}
      style={{ backgroundColor: color }}
    >
      {Icon ? <Icon className="size-[50%]" /> : name.trim().charAt(0).toUpperCase()}
    </span>
  );
}
