# Screen Time

A self-hosted parental screen-time limiter. Kid devices (Android phone and tablet, Windows 11 PCs) enforce daily limits locally and stay in sync through a small server; parents manage everything from a web app and an Android app.

- Specification: [docs/SPEC.md](docs/SPEC.md)
- Build plan: [docs/BUILD-PLAN.md](docs/BUILD-PLAN.md)
- Rules for coding agents: [AGENTS.md](AGENTS.md)

## Layout

| Folder | What |
|---|---|
| `contract/` | Generated OpenAPI contract (`openapi.json`) |
| `packages/schemas/` | Zod schemas shared by server and web (`@screentime/schemas`) |
| `server/` | TypeScript API on Hono (`@screentime/server`) |
| `web/` | Parent web app (React) |
| `android/` | Android kid app and parent app (Kotlin) |
| `windows/` | Windows enforcer service and tray app (C#) |
| `test-vectors/` | Shared test cases for the time engine |
| `deploy/` | Docker Compose and deployment files |
| `docs/` | Spec, build plan, cards, guides |

## Quick start (TypeScript parts)

Needs Node.js 24 and pnpm 11.

```powershell
pnpm install
pnpm test
pnpm dev:server
```

Then open http://localhost:8080/health.
