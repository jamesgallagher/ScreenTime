import type { AuthResponse } from '@screentime/schemas';

/** An error answer from the API (`{ "error": { "code", "message" } }`), or a network failure (status 0). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Fetch = (input: string, init: RequestInit) => Promise<Response>;
type AuthListener = (auth: AuthResponse | null) => void;

const JSON_HEADERS = { 'content-type': 'application/json' };

async function errorOf(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as { error?: { code?: unknown; message?: unknown } };
    const { code, message } = body.error ?? {};
    if (typeof code === 'string' && typeof message === 'string') return new ApiError(res.status, code, message);
  } catch {
    // Not JSON: fall through.
  }
  return new ApiError(res.status, 'http_error', `Something went wrong (${res.status}). Try again.`);
}

/**
 * The parent web app's client for /v1 on its own origin (docs/SPEC.md §11.1). The access token lives in
 * memory only. The refresh token is the HttpOnly `st_refresh` cookie: the browser sends it to /v1/auth by
 * itself and page scripts never see it. A 401 refreshes once and retries; concurrent callers share one refresh.
 */
export class Api {
  private accessToken: string | null = null;
  private refreshing: Promise<AuthResponse | null> | null = null;
  private readonly listeners = new Set<AuthListener>();
  private readonly fetchFn: Fetch;

  constructor(fetchFn?: Fetch) {
    this.fetchFn = fetchFn ?? ((input, init) => fetch(input, init));
  }

  /** Called with the new sign-in after every sign-in and refresh, and with null when signed out. */
  onAuthChange(listener: AuthListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setAuth(auth: AuthResponse | null) {
    this.accessToken = auth?.accessToken ?? null;
    for (const listener of this.listeners) listener(auth);
  }

  private async send(path: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchFn(path, init);
    } catch {
      throw new ApiError(0, 'network', "Can't reach ScreenTime. Check your connection and try again.");
    }
  }

  /** Emails a sign-in code. Answers the same whether or not the email can sign in. */
  async requestCode(email: string): Promise<void> {
    const res = await this.send('/v1/auth/otp/request', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ email }),
    });
    if (!res.ok) throw await errorOf(res);
  }

  async verifyCode(email: string, code: string): Promise<AuthResponse> {
    const res = await this.send('/v1/auth/otp/verify', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ email, code, client: 'web', clientLabel: 'Web browser' }),
    });
    if (!res.ok) throw await errorOf(res);
    const auth = (await res.json()) as AuthResponse;
    this.setAuth(auth);
    return auth;
  }

  /** Uses the cookie to get a new access token. Null (and signed out) when the session is gone. */
  refresh(): Promise<AuthResponse | null> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh(): Promise<AuthResponse | null> {
    const res = await this.send('/v1/auth/refresh', { method: 'POST', headers: JSON_HEADERS, body: '{}' });
    if (res.status === 401) {
      this.setAuth(null);
      return null;
    }
    if (!res.ok) throw await errorOf(res);
    const auth = (await res.json()) as AuthResponse;
    this.setAuth(auth);
    return auth;
  }

  /** Ends the session on the server (which also clears the cookie). Signed out here even if that fails. */
  async signOut(): Promise<void> {
    try {
      if (this.accessToken) {
        await this.send('/v1/auth/logout', { method: 'POST', headers: { authorization: `Bearer ${this.accessToken}` } });
      }
    } catch {
      // Signed out locally anyway.
    }
    this.setAuth(null);
  }

  /** A signed-in call. Resolves to the parsed JSON body, or undefined for 204. */
  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.accessToken && !(await this.refresh())) throw new ApiError(401, 'unauthorized', 'Sign in again.');
    let res = await this.call(method, path, body);
    if (res.status === 401) {
      if (!(await this.refresh())) throw new ApiError(401, 'unauthorized', 'Sign in again.');
      res = await this.call(method, path, body);
    }
    if (!res.ok) throw await errorOf(res);
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  private call(method: string, path: string, body: unknown): Promise<Response> {
    const headers: Record<string, string> = { authorization: `Bearer ${this.accessToken ?? ''}` };
    if (body !== undefined) headers['content-type'] = 'application/json';
    return this.send(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', path, body);
  }

  delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }
}
