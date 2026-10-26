import type { Device, Kid } from '@screentime/schemas';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { ChevronRight, Plus, RefreshCw, Users } from 'lucide-react';
import { useState } from 'react';
import { KidAvatar } from '@/components/kid-avatar';
import { KidDialog } from '@/components/kid-dialog';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { api } from '@/lib/auth';

export function useKids() {
  return useQuery({ queryKey: ['kids'], queryFn: () => api.get<Kid[]>('/v1/kids') });
}

/** Every device in the family. `poll` (ms) while waiting for a new device to enrol. */
export function useDevices(poll?: number) {
  return useQuery({ queryKey: ['devices'], queryFn: () => api.get<Device[]>('/v1/devices'), refetchInterval: poll });
}

function devicesText(devices: Device[]): string {
  if (devices.length === 0) return 'No devices yet';
  return devices.map((d) => d.name).join(', ');
}

/** docs/SPEC.md §16.5 Kids: one row per kid, linking to the kid's page, and Add kid. */
export function KidsPage() {
  const kids = useKids();
  const devices = useDevices();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const addButton = (
    <Button onClick={() => setAdding(true)}>
      <Plus />
      Add kid
    </Button>
  );

  return (
    <>
      <PageHeader title="Kids" description="Schedules, devices and contacts." actions={kids.data?.length ? addButton : undefined} />
      {kids.isError && !kids.data ? (
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
      ) : !kids.data ? (
        <div className="flex flex-col gap-3" aria-label="Loading">
          {[0, 1].map((i) => (
            <Card key={i} className="h-20 animate-pulse bg-surface-variant/50" />
          ))}
        </div>
      ) : kids.data.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-surface-variant text-muted">
              <Users className="size-6" />
            </span>
            <p className="font-medium">No kids yet</p>
            <p className="max-w-sm text-sm text-muted">Add a kid, then add their phone, tablet or PC.</p>
            {addButton}
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {kids.data.map((kid) => (
            <Link
              key={kid.id}
              to="/kids/$kidId"
              params={{ kidId: kid.id }}
              className="rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Card className="flex items-center gap-4 p-4 transition-colors hover:bg-surface-variant/50">
                <KidAvatar name={kid.name} color={kid.avatarColor} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{kid.name}</p>
                  <p className="truncate text-sm text-muted">
                    {devices.data ? devicesText(devices.data.filter((d) => d.kidId === kid.id)) : '\u00a0'}
                  </p>
                </div>
                <ChevronRight className="size-5 text-muted" />
              </Card>
            </Link>
          ))}
        </div>
      )}
      <KidDialog
        open={adding}
        kid={null}
        onClose={() => setAdding(false)}
        onSaved={(kid) => void navigate({ to: '/kids/$kidId', params: { kidId: kid.id } })}
      />
    </>
  );
}
