import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';

export function NotFoundPage() {
  return (
    <div className="flex flex-col items-center gap-4 py-16 text-center">
      <p className="text-5xl font-semibold text-muted">404</p>
      <p className="font-medium">That page doesn't exist.</p>
      <Button asChild variant="outline">
        <Link to="/">Go to Today</Link>
      </Button>
    </div>
  );
}
