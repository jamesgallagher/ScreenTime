import type { Family } from '@screentime/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { ApiError } from '@/lib/api';
import { api } from '@/lib/auth';
import { type FamilyDraft, familyErrors, timeZones, zoneLabel } from '@/lib/settings';

function messageOf(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong. Try again.';
}

function draftOf(family: Family): FamilyDraft {
  return { name: family.name, timezone: family.timezone, emergencyNumber: family.emergencyNumber };
}

/** Only the fields that changed, trimmed: PATCH /v1/family. */
function patchOf(draft: FamilyDraft, family: Family): Partial<FamilyDraft> {
  const patch: Partial<FamilyDraft> = {};
  if (draft.name.trim() !== family.name) patch.name = draft.name.trim();
  if (draft.timezone !== family.timezone) patch.timezone = draft.timezone;
  if (draft.emergencyNumber.trim() !== family.emergencyNumber) patch.emergencyNumber = draft.emergencyNumber.trim();
  return patch;
}

/** docs/SPEC.md §9.2: the family's name, time zone and emergency number. Devices get changes when they sync. */
export function FamilyCard() {
  const queryClient = useQueryClient();
  const family = useQuery({ queryKey: ['family'], queryFn: () => api.get<Family>('/v1/family') });
  const [draft, setDraft] = useState<FamilyDraft | null>(null);
  const [tried, setTried] = useState(false);
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: (patch: Partial<FamilyDraft>) => api.patch<Family>('/v1/family', patch),
    onSuccess: (result) => {
      queryClient.setQueryData(['family'], result);
      setDraft(null);
      setTried(false);
      setSaved(true);
      // The sign-in holds the family too (the time zone shapes every time on every page): fetch it again.
      void api.refresh().then(() => queryClient.invalidateQueries());
    },
  });
  const current = family.data?.timezone ?? '';
  const zones = useMemo(() => (current ? timeZones(current) : []), [current]);

  if (!family.data) {
    return family.isError ? (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <p className="text-sm text-danger" role="alert">
            {messageOf(family.error)}
          </p>
          <Button variant="outline" onClick={() => void family.refetch()}>
            <RefreshCw />
            Try again
          </Button>
        </CardContent>
      </Card>
    ) : (
      <Card className="h-64 animate-pulse bg-surface-variant/50" aria-label="Loading" />
    );
  }

  const value = draft ?? draftOf(family.data);
  const patch = patchOf(value, family.data);
  const dirty = Object.keys(patch).length > 0;
  const errors = tried ? familyErrors(value) : {};
  const edit = (change: Partial<FamilyDraft>) => {
    setDraft({ ...value, ...change });
    setSaved(false);
    save.reset();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Family</CardTitle>
        <CardDescription>Kids' devices pick up changes the next time they are online.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <Label htmlFor="family-name">Family name</Label>
          <Input
            id="family-name"
            maxLength={100}
            autoComplete="off"
            value={value.name}
            aria-invalid={errors.name !== undefined || undefined}
            onChange={(e) => edit({ name: e.target.value })}
          />
          {errors.name && <p className="text-xs text-danger">{errors.name}</p>}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="family-timezone">Time zone</Label>
          <Select id="family-timezone" value={value.timezone} onChange={(e) => edit({ timezone: e.target.value })}>
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zoneLabel(zone)}
              </option>
            ))}
          </Select>
          <p className="text-xs text-muted">Days start at midnight here, and bedtimes and wake-up times use it.</p>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="family-emergency">Emergency number</Label>
          <Input
            id="family-emergency"
            className="max-w-40"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            value={value.emergencyNumber}
            aria-invalid={errors.emergencyNumber !== undefined || undefined}
            onChange={(e) => edit({ emergencyNumber: e.target.value })}
          />
          {errors.emergencyNumber ? (
            <p className="text-xs text-danger">{errors.emergencyNumber}</p>
          ) : (
            <p className="text-xs text-muted">Kids' phones can always call it, even when locked. In Australia it is 000.</p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-outline pt-4">
          <p aria-live="polite" className="mr-auto text-sm">
            {save.error ? (
              <span className="text-danger">{messageOf(save.error)}</span>
            ) : saved ? (
              <span className="flex items-center gap-1.5 text-primary">
                <Check className="size-4" />
                Saved.
              </span>
            ) : dirty ? (
              <span className="text-muted">Unsaved changes</span>
            ) : null}
          </p>
          {dirty && (
            <Button
              variant="ghost"
              disabled={save.isPending}
              onClick={() => {
                setDraft(null);
                setTried(false);
                save.reset();
              }}
            >
              Undo changes
            </Button>
          )}
          <Button
            disabled={!dirty || save.isPending}
            onClick={() => {
              setTried(true);
              const found = familyErrors(value);
              if (!found.name && !found.emergencyNumber) save.mutate(patch);
            }}
          >
            {save.isPending && <Loader2 className="animate-spin" />}
            Save family
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
