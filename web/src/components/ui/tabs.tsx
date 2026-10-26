import { Tabs as TabsPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** shadcn/ui tabs as a pill switch, like the pool switch of the adjust dialog. */
export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn('flex w-full gap-1 overflow-x-auto rounded-full bg-surface-variant p-1 sm:w-fit', className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        'h-10 flex-1 rounded-full px-2 text-sm font-medium whitespace-nowrap text-muted transition-colors outline-none hover:text-on-surface focus-visible:ring-2 focus-visible:ring-primary data-[state=active]:bg-surface data-[state=active]:text-on-surface data-[state=active]:shadow-sm sm:flex-none sm:px-4',
        className,
      )}
      {...props}
    />
  );
}

/** Kept mounted while hidden, so unsaved edits survive a switch to another tab. */
export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      forceMount
      className={cn('mt-6 outline-none data-[state=inactive]:hidden', className)}
      {...props}
    />
  );
}
