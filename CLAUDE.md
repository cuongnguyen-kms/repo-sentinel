# CLAUDE.md

Guidance for Claude Code (or any coding agent) working in this repo. See [README.md](./README.md) for setup/run instructions and feature scope, and [ROADMAP.md](./ROADMAP.md) for the backlog of what's still missing — this file covers things you need to know *while making changes* that aren't obvious from the code alone.

## What this project is

RepoSentinel is a Fastify + Prisma + BullMQ + Socket.IO backend with an Angular frontend that monitors GitHub Enterprise repositories, tracks pull requests, and runs AI-powered code reviews via the Claude Code CLI. See [README.md § Scope](./README.md#scope) for what's implemented vs. still on the backlog. Don't assume a feature exists without checking this repo's Prisma schema/routes first.

## Dev environment on this machine

Infra runs **natively**, not via `docker-compose.yml` (that file exists as a documented alternative but isn't what's actually running):
- Postgres: native Windows service on port `5432`, database `reposentinel`, role `reposentinel`/`secret` (has `CREATEDB` for Prisma's shadow DB)
- Redis: native instance on port `6379`, **db index 1** (`redis://localhost:6379/1`) — this index is reserved for this project; don't switch it without checking what else is running against the same Redis instance
- API port `3101`, Web port `5175`

Secrets live in `.env` at repo root (not committed). The seeded admin login (`ADMIN_SEED_EMAIL`/`ADMIN_SEED_PASSWORD`) is also there — that account is created automatically on first API boot via `auth-seed.ts`.

Start both apps: `npm run dev` (Turborepo). Individually: `cd apps/api && npm run dev` (tsx watch) / `cd apps/web && npm run dev` (`ng serve`).

## Backend (`apps/api`) conventions

- Routes are thin: parse with Zod (`schemas/*.ts`), call a `services/*.ts` function, shape the response. Don't put business logic in route handlers.
- Every mutating route is `[requireAuth, requirePermission(Resource.X, Action.Y)]`. `Resource`/`Action` come from `@repo-sentinel/types`.
- `queues/run-ai-review-job.ts` is the review pipeline: clone → diff → prompt → stream CLI → parse JSON → persist → auto-post/notify. Extend from this file's flow if you need to add steps.
- `apps/api/tsconfig.json` sets `"declaration": false` — without it, `tsc` fails on `lib/auth.ts` with `TS2742` (better-auth's inferred type isn't portable without a zod-v4-core type reference). This is a real workaround, not accidental; don't re-enable declaration emit for this app without fixing that root cause first.
- No test suite is set up for `apps/api` yet (a handful of `__tests__/*.test.ts` files exist for the admin RBAC services). `tsc --noEmit` (or `ng build` for web) is the current correctness gate.

## Frontend (`apps/web`) conventions

- Standalone components only, `ChangeDetectionStrategy.OnPush`, Signals for state, `inject()` for DI. No NgModules, no NgRx — each feature has its own thin `*.service.ts` wrapping `HttpClient`.
- **Theming**: `styles.scss` defines a single Material 3 theme with `theme-type: color-scheme`, which makes every `--mat-sys-*` token resolve via the CSS `light-dark()` function. Dark mode is just the `color-scheme` CSS property flipping between `light`/`dark`/`light dark` — see `core/services/theme.service.ts`. **Do not add a second `mat.theme()` block for dark mode** — that's the old pattern this deliberately avoids.
- Any custom color you add (not going through a `--mat-sys-*` token) **must** be written as `light-dark(lightValue, darkValue)`, or it will look broken in one of the two modes. Reuse the shared `.chip-success` / `.chip-warn` / `.chip-error` / `.chip-info` / `.chip-neutral` classes in `styles.scss` for status indicators instead of inventing new hardcoded colors — they're already used for repo status, PR state, AI review status, and finding severity.
- Brand palette is violet primary / magenta tertiary (`mat.$violet-palette` / `mat.$magenta-palette`) — this does **not** match the logo's navy/terracotta brand colors in `public/assets/`. That mismatch is known and unresolved; don't "fix" it unilaterally, ask first.
- Logo assets live in `public/assets/` (`reposentinel-icon.svg` is self-contained with its own dark-navy background baked in, so it's used directly via `<img>` in both the sidebar and login page without a themed wrapper — it looks the same in light and dark mode by design). Other variants (`*-mark-reversed.svg`, `*-lockup*.svg`, mono variants) exist but aren't wired up anywhere yet.

## Known gotchas hit while building this

- **Angular dev server (esbuild/Vite watch) can cache a stale "file not found" result** for a newly created file referenced via `styleUrl`/`templateUrl`, even after the file exists on disk with a valid timestamp. If the build log insists a just-created file "could not be found" after a couple of rebuild cycles, stop debugging paths and restart the dev server (`preview_stop` + `preview_start`, or kill and re-run `ng serve`) — it's an incremental-build cache issue, not a real path bug.
- The `preview_screenshot` tool can time out/hang in this environment even when the app is fine. Don't treat a screenshot timeout as an app failure — cross-check with `preview_eval` (e.g. `document.readyState`, `document.body.innerText`) or `preview_inspect` (computed styles) before concluding something is broken.
- `preview_logs` returns an **accumulating buffer**, not just the latest state — old errors from earlier in the session stay in the tail output. Correlate error timestamps against the current wall clock (logs are UTC) before assuming a shown error is current.
- When parsing a curl-generated Netscape cookie-jar file programmatically, curl prefixes HttpOnly cookies with `#HttpOnly_` on the domain field. Don't blanket-skip every line starting with `#` as a comment — you'll silently drop the session cookie.

## Where to look first

- Working from the deferred-feature backlog (wiki sync, auto-fix, machine-client M2M, etc.) → [ROADMAP.md](./ROADMAP.md).
- New frontend page → follow the existing `features/<domain>/<domain>-page/` structure (page component + feature `.service.ts` + any dialogs as siblings).
- Full setup/run instructions, scripts, and feature scope → [README.md](./README.md).
