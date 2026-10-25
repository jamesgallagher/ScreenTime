import type { Me } from '@screentime/schemas';
import { Link } from '@tanstack/react-router';
import { Inbox, LogOut, Menu, Settings, Shield, Sun, Users } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Brand } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { api } from '@/lib/auth';

const FAMILY_LINKS = [
  { to: '/', label: 'Today', icon: Sun },
  { to: '/inbox', label: 'Inbox', icon: Inbox },
  { to: '/kids', label: 'Kids', icon: Users },
  { to: '/settings', label: 'Settings', icon: Settings },
] as const;
const ADMIN_LINK = { to: '/admin', label: 'Admin', icon: Shield } as const;

/** Today, Inbox, Kids, Settings for a parent; Admin for the super admin (a super admin with no family sees only Admin). */
export function navLinks(me: Me) {
  const family = me.family ? FAMILY_LINKS : [];
  return me.roles.includes('superadmin') ? [...family, ADMIN_LINK] : [...family];
}

function NavList({ me, onNavigate }: { me: Me; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-1">
      {navLinks(me).map(({ to, label, icon: Icon }) => (
        <Link
          key={to}
          to={to}
          onClick={onNavigate}
          activeOptions={{ exact: to === '/' }}
          className="flex h-11 items-center gap-3 rounded-full px-4 text-sm font-medium text-muted transition-colors hover:bg-surface-variant hover:text-on-surface data-[status=active]:bg-primary/10 data-[status=active]:text-primary"
        >
          <Icon className="size-5" />
          {label}
        </Link>
      ))}
    </nav>
  );
}

function Account({ me }: { me: Me }) {
  return (
    <div className="flex items-center gap-3 border-t border-outline pt-4">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{me.parent?.displayName ?? 'Super admin'}</p>
        <p className="truncate text-xs text-muted">{me.parent?.email ?? me.family?.name ?? ''}</p>
      </div>
      <Button variant="ghost" size="icon" className="size-10" aria-label="Sign out" onClick={() => void api.signOut()}>
        <LogOut />
      </Button>
    </div>
  );
}

/**
 * docs/SPEC.md §16.5: a 240 px sidebar from 1024 px up; below that a top bar whose menu button opens the
 * same links in a sheet. Page content is at most 1100 px wide.
 */
export function AppShell({ me, children }: { me: Me; children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="min-h-dvh lg:pl-60">
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col gap-6 border-r border-outline bg-surface p-4 lg:flex">
        <Brand className="px-2 pt-2" />
        <div className="flex-1">
          <NavList me={me} />
        </div>
        <Account me={me} />
      </aside>

      <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-outline bg-surface px-2 lg:hidden">
        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Open menu">
              <Menu />
            </Button>
          </SheetTrigger>
          <SheetContent className="gap-6 p-4">
            <SheetTitle asChild>
              <div>
                <Brand className="px-2 pt-2" />
              </div>
            </SheetTitle>
            <div className="flex-1">
              <NavList me={me} onNavigate={() => setMenuOpen(false)} />
            </div>
            <Account me={me} />
          </SheetContent>
        </Sheet>
        <Brand />
      </header>

      <main className="mx-auto w-full max-w-[1100px] px-4 py-6 lg:px-8 lg:py-10">{children}</main>
    </div>
  );
}
