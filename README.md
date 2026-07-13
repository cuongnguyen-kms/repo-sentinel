# RepoSentinel

An Angular + Fastify replica of [RepoWatch](../repo-watch-main) — monitors GitHub Enterprise repositories, tracks pull requests, and runs AI-powered code reviews using the Claude Code CLI.

**Status**: MVP — see [Scope](#scope) below.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Angular 22, Angular Material, Signals (no NgRx) |
| Backend | Fastify 5, Socket.IO 4, BullMQ 5 |
| Database | PostgreSQL 16, Prisma ORM 6 |
| Queue | Redis 7 (BullMQ) |
| Monorepo | npm workspaces, Turborepo 2 |
| Runtime | Node.js 22+ |

## Project Structure

```
apps/
  api/          Fastify REST API + Socket.IO WebSocket server (port 3101)
  web/          Angular SPA (port 5175)
packages/
  db/           Prisma client singleton + schema
  ghe-client/   GitHub Enterprise REST+GraphQL client (Octokit)
  types/        Shared TypeScript types
  config/       Shared tsconfig presets
```

## Prerequisites

- Node.js >= 22, npm >= 10
- PostgreSQL 16 and Redis 7 (native install or Docker — see `docker-compose.yml`)
- Claude Code CLI (`claude`) installed and authenticated on the machine running `apps/api` — the AI review pipeline spawns it via `child_process.spawn`

## Getting Started

### 1. Install

```bash
npm install
```

### 2. Environment variables

Copy `.env.example` to `.env` and fill in real values:

```bash
cp .env.example .env
```

Generate the three secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Infrastructure (Postgres + Redis)

**With Docker:**

```bash
docker compose up -d
```

**Without Docker** (e.g. reusing a native Postgres/Redis instance already running for another project): create a dedicated role/database and point `DATABASE_URL` at it. If sharing a Redis instance with another app, use a distinct db index (e.g. `redis://localhost:6379/1`) to avoid queue/session key collisions.

```sql
CREATE USER reposentinel WITH PASSWORD 'secret' CREATEDB;
CREATE DATABASE reposentinel OWNER reposentinel;
```

### 4. Database migration

```bash
npm run db:generate
npm run db:migrate
```

### 5. Start dev servers

```bash
npm run dev
```

- API: `http://localhost:3101`
- Web: `http://localhost:5175`

Log in with `ADMIN_SEED_EMAIL` / `ADMIN_SEED_PASSWORD` from `.env` — this admin user (with full `*` permission bypass) is seeded automatically on first API startup, along with the RBAC scaffolding (Admin/Reviewer/Viewer roles+groups, 44 permissions across 11 resources).

### 6. Add a GitHub connection

In the UI: **Connections** → **Add Connection**. Enter your GHE hostname (`github.com` or a GHE Server hostname) and a personal access token (repo scope). The token is encrypted at rest (AES-256-GCM).

## Scope

This is an intentional MVP slice, not a full port of the original RepoWatch:

**Included**: auth/RBAC, GHE connections, watched repos + polling, pull request tracking, AI code review (trigger → clone → diff → Claude CLI → streamed terminal output → structured findings + score), review history, notifications, core AI-review settings.

**Not included** (out of scope for this pass): JIRA/Atlassian sync, wiki design-doc injection, auto-fix jobs, machine-client OAuth2 (M2M auth), Chrome extension, GitHub comment posting/resolution, admin RBAC management UI, chat sessions, sprint reports, Google Chat notifications. The Prisma schema, RBAC resource enum, and settings keys were trimmed to match.

See [ROADMAP.md](./ROADMAP.md) for what each of those areas needs (schema models to restore, backend files to port, frontend pages to build) and a suggested order to tackle them in.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start both apps in dev mode |
| `npm run build` | Build all apps |
| `npm run db:generate` | Regenerate Prisma client after schema changes |
| `npm run db:migrate` | Run pending database migrations |
