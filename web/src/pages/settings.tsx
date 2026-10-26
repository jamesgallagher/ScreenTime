import { FamilyCard } from '@/components/family-card';
import { NotificationsCard } from '@/components/notifications-card';
import { PageHeader } from '@/components/page-header';
import { ParentCodeCard } from '@/components/parent-code-card';
import { ParentsCard } from '@/components/parents-card';
import { PresetsCard } from '@/components/presets-card';

/**
 * docs/SPEC.md §16.5 Settings: one column of cards, most used first. The parent code is at the top because
 * a parent opens it in a hurry, standing next to an offline device.
 */
export function SettingsPage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader title="Settings" />
      <ParentCodeCard />
      <NotificationsCard />
      <PresetsCard />
      <ParentsCard />
      <FamilyCard />
    </div>
  );
}
