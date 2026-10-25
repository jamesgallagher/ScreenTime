import { Construction } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent } from '@/components/ui/card';

/** Stands in for a page a later card builds (docs/BUILD-PLAN.md, CARD-023 to 026). */
export function ComingSoon({ title, description }: { title: string; description: string }) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-surface-variant text-muted">
            <Construction className="size-6" />
          </span>
          <p className="font-medium">Coming soon</p>
          <p className="max-w-sm text-sm text-muted">This page is not built yet.</p>
        </CardContent>
      </Card>
    </>
  );
}
