# web

Parent web app: TypeScript, React 19, Vite, TanStack Router and Query, Tailwind CSS v4, shadcn/ui-style components. Built into static files that the server will serve (CARD-027). See docs/SPEC.md §16.5.

- `pnpm dev:web` (repo root): http://localhost:5173, with `/v1` and `/health` passed to the API on http://localhost:8080 (`pnpm dev:server` or the Docker stack).
- Sign in with a parent's email or `SUPER_ADMIN_EMAIL`. Without SMTP settings the API prints the code in its log.
- Design tokens: `src/index.css` (docs/SPEC.md §16.1). Routes: `src/router.tsx`. API client: `src/lib/api.ts`.
- The refresh token is an HttpOnly cookie (`st_refresh`); the access token is kept in memory only.
