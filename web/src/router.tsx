import {
  createRootRoute,
  createRoute,
  createRouter,
  Navigate,
  Outlet,
  useRouterState,
} from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { SosBanner } from '@/components/sos-banner';
import { useAuth } from '@/lib/auth';
import { AdminPage } from '@/pages/admin';
import { InboxPage } from '@/pages/inbox';
import { KidPage } from '@/pages/kid';
import { KidsPage } from '@/pages/kids';
import { NotFoundPage } from '@/pages/not-found';
import { SettingsPage } from '@/pages/settings';
import { SignInPage } from '@/pages/sign-in';
import { TodayPage } from '@/pages/today';

function FullScreenSpinner() {
  return (
    <div className="flex min-h-dvh items-center justify-center text-muted" aria-label="Loading">
      <Loader2 className="size-8 animate-spin" />
    </div>
  );
}

/** Every page but sign-in: signed-out visitors go to /sign-in; a super admin with no family only has /admin. An active SOS shows on top of every page. */
function SignedInLayout() {
  const auth = useAuth();
  const path = useRouterState({ select: (s) => s.location.pathname });
  if (auth.status === 'loading') return <FullScreenSpinner />;
  if (auth.status === 'signedOut') return <Navigate to="/sign-in" />;
  if (!auth.me.family && path !== '/admin') return <Navigate to="/admin" />;
  return (
    <AppShell me={auth.me}>
      <SosBanner />
      <Outlet />
    </AppShell>
  );
}

function AdminOnly() {
  const auth = useAuth();
  if (auth.status !== 'signedIn' || !auth.me.roles.includes('superadmin')) return <Navigate to="/" />;
  return <AdminPage />;
}

const rootRoute = createRootRoute({ component: Outlet, notFoundComponent: NotFoundPage });

const signInRoute = createRoute({ getParentRoute: () => rootRoute, path: '/sign-in', component: SignInPage });

const appRoute = createRoute({ getParentRoute: () => rootRoute, id: 'app', component: SignedInLayout });

const todayRoute = createRoute({ getParentRoute: () => appRoute, path: '/', component: TodayPage });
const inboxRoute = createRoute({ getParentRoute: () => appRoute, path: '/inbox', component: InboxPage });
const kidsRoute = createRoute({ getParentRoute: () => appRoute, path: '/kids', component: KidsPage });
const kidRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/kids/$kidId',
  component: function KidRoute() {
    const { kidId } = kidRoute.useParams();
    // Keyed by kid, so unsaved edits never carry over to another kid's page.
    return <KidPage key={kidId} kidId={kidId} />;
  },
});
const settingsRoute = createRoute({ getParentRoute: () => appRoute, path: '/settings', component: SettingsPage });
const adminRoute = createRoute({ getParentRoute: () => appRoute, path: '/admin', component: AdminOnly });

const routeTree = rootRoute.addChildren([
  signInRoute,
  appRoute.addChildren([todayRoute, inboxRoute, kidsRoute, kidRoute, settingsRoute, adminRoute]),
]);

export const router = createRouter({ routeTree, defaultPreload: 'intent' });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
