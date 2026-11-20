import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { ApiError } from '@/lib/api';
import {
  CATEGORIES,
  categoryLabel,
  clearSiteClass,
  PICKABLE_KINDS,
  type SiteCategory,
  type SiteClassOverride,
  type SiteReportSite,
  setSiteClass,
  siteName,
} from '@/lib/sites';

/** A parent sets what a site is, for the whole family (docs/SPEC.md §12.10), or goes back to the automatic one. */
export function SiteClassDialog({ site, onClose }: { site: SiteReportSite | null; onClose: () => void }) {
  return (
    <Dialog open={site !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>{site && <SiteClassBody key={site.site} site={site} onDone={onClose} />}</DialogContent>
    </Dialog>
  );
}

function SiteClassBody({ site, onDone }: { site: SiteReportSite; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<SiteClassOverride['kind']>(site.kind && site.kind !== 'unknown' ? site.kind : 'website');
  const [category, setCategory] = useState<SiteCategory>(site.category ?? 'other');
  const done = () => {
    void queryClient.invalidateQueries({ queryKey: ['site-report'] });
    onDone();
  };
  const save = useMutation({ mutationFn: () => setSiteClass(site.site, { kind, category }), onSuccess: done });
  const reset = useMutation({ mutationFn: () => clearSiteClass(site.site), onSuccess: done });
  const error = save.error ?? reset.error;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <DialogTitle>{siteName(site)}</DialogTitle>
        <DialogDescription>
          {site.label ? `${site.site}. ` : ''}Set what this site is for the whole family. The automatic sorting never changes it back.
        </DialogDescription>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="site-kind">What is it?</Label>
        <Select id="site-kind" value={kind} onChange={(e) => setKind(e.target.value as SiteClassOverride['kind'])}>
          {PICKABLE_KINDS.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="site-category">Category</Label>
        <Select id="site-category" value={category} onChange={(e) => setCategory(e.target.value as SiteCategory)}>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {categoryLabel(c)}
            </option>
          ))}
        </Select>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error instanceof ApiError ? error.message : 'Something went wrong. Try again.'}
        </p>
      )}
      <div className="flex flex-col gap-2">
        <Button type="submit" disabled={save.isPending || reset.isPending}>
          {save.isPending && <Loader2 className="animate-spin" />}
          Save
        </Button>
        {site.source === 'parent' && (
          <Button type="button" variant="ghost" disabled={save.isPending || reset.isPending} onClick={() => reset.mutate()}>
            {reset.isPending && <Loader2 className="animate-spin" />}
            Go back to automatic
          </Button>
        )}
      </div>
    </form>
  );
}
