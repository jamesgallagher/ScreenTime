import type { Kid, Pool } from '@screentime/schemas';
import { Link } from '@tanstack/react-router';
import { ChevronLeft, Pencil, RefreshCw, UserX } from 'lucide-react';
import { useState } from 'react';
import { AdjustDialog } from '@/components/adjust-dialog';
import { ContactsEditor } from '@/components/contacts-editor';
import { DevicesPanel } from '@/components/devices-panel';
import { KidAvatar } from '@/components/kid-avatar';
import { KidDialog } from '@/components/kid-dialog';
import { ScheduleEditor } from '@/components/schedule-editor';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ApiError } from '@/lib/api';
import { kidChips } from '@/lib/today';
import { useKids } from '@/pages/kids';
import { ChipList, PoolRow, useToday } from '@/pages/today';

function TodayPanel({ kid }: { kid: Kid }) {
  const today = useToday();
  const [adjusting, setAdjusting] = useState<Pool | null>(null);
  const todayKid = today.data?.kids.find((k) => k.id === kid.id) ?? null;
  if (!todayKid || !today.data) return <Card className="h-48 animate-pulse bg-surface-variant/50" aria-label="Loading" />;
  return (
    <Card>
      <CardContent className="flex flex-col gap-5">
        {todayKid.pools.map((pool) => (
          <PoolRow key={pool.pool} kid={todayKid} pool={pool} onAdjust={() => setAdjusting(pool.pool)} />
        ))}
        <ChipList chips={kidChips(todayKid, new Date(today.data.serverTime))} />
      </CardContent>
      <AdjustDialog kid={adjusting ? todayKid : null} pool={adjusting ?? 'screens'} onClose={() => setAdjusting(null)} />
    </Card>
  );
}

function BackLink() {
  return (
    <Link
      to="/kids"
      className="mb-4 inline-flex items-center gap-1 rounded-full text-sm font-medium text-muted outline-none hover:text-on-surface focus-visible:ring-2 focus-visible:ring-primary"
    >
      <ChevronLeft className="size-4" />
      Kids
    </Link>
  );
}

/** docs/SPEC.md §16.5 Kid detail: tabs Today, Schedule, Devices, Contacts. */
export function KidPage({ kidId }: { kidId: string }) {
  const kids = useKids();
  const [editing, setEditing] = useState(false);
  const kid = kids.data?.find((k) => k.id === kidId);

  if (!kids.data) {
    return (
      <>
        <BackLink />
        {kids.isError ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
              <p className="text-sm text-danger" role="alert">
                {kids.error instanceof ApiError ? kids.error.message : 'Something went wrong. Try again.'}
              </p>
              <Button variant="outline" onClick={() => void kids.refetch()}>
                <RefreshCw />
                Try again
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card className="h-64 animate-pulse bg-surface-variant/50" aria-label="Loading" />
        )}
      </>
    );
  }

  if (!kid) {
    return (
      <>
        <BackLink />
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-surface-variant text-muted">
              <UserX className="size-6" />
            </span>
            <p className="font-medium">This kid is not in your family</p>
            <p className="max-w-sm text-sm text-muted">They may have been removed. Pick a kid from the list.</p>
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <>
      <BackLink />
      <div className="mb-6 flex items-center gap-4">
        <KidAvatar name={kid.name} color={kid.avatarColor} className="size-14 text-xl" />
        <h1 className="min-w-0 flex-1 truncate text-2xl font-semibold tracking-tight">{kid.name}</h1>
        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
          <Pencil />
          Edit
        </Button>
      </div>
      <Tabs defaultValue="today">
        <TabsList aria-label={`${kid.name}'s settings`}>
          <TabsTrigger value="today">Today</TabsTrigger>
          <TabsTrigger value="schedule">Schedule</TabsTrigger>
          <TabsTrigger value="devices">Devices</TabsTrigger>
          <TabsTrigger value="contacts">Contacts</TabsTrigger>
        </TabsList>
        <TabsContent value="today">
          <TodayPanel kid={kid} />
        </TabsContent>
        <TabsContent value="schedule">
          <ScheduleEditor kidId={kid.id} kidName={kid.name} />
        </TabsContent>
        <TabsContent value="devices">
          <DevicesPanel kidId={kid.id} kidName={kid.name} />
        </TabsContent>
        <TabsContent value="contacts">
          <ContactsEditor kidId={kid.id} kidName={kid.name} />
        </TabsContent>
      </Tabs>
      <KidDialog open={editing} kid={kid} onClose={() => setEditing(false)} />
    </>
  );
}
