import type { Me } from '@screentime/schemas';
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import { Api } from '@/lib/api';

export type AuthState = { status: 'loading' } | { status: 'signedOut' } | { status: 'signedIn'; me: Me };

/** The one API client of the page. */
export const api = new Api();

const AuthContext = createContext<AuthState>({ status: 'loading' });

/** On load, tries the refresh cookie once: a parent who signed in before goes straight in. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    const stop = api.onAuthChange((auth) => setState(auth ? { status: 'signedIn', me: auth.me } : { status: 'signedOut' }));
    api.refresh().catch(() => setState({ status: 'signedOut' }));
    return stop;
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
