# CLAUDE.md

Guidance for Claude Code (or any coding agent) working in this repo. See [README.md](./README.md) for setup/run instructions and feature scope, and [ROADMAP.md](./ROADMAP.md) for the detailed backlog of what's still missing for full parity with the original — this file covers things you need to know *while making changes* that aren't obvious from the code alone.

## What this project is

RepoSentinel is an MVP replica of a sibling project, `../repo-watch-main` (RepoWatch), with the **same backend stack** (Fastify + Prisma + BullMQ + Socket.IO) but an **Angular frontend instead of React**. It intentionally implements only a subset of RepoWatch's features — see [README.md § Scope](./README.md#scope) for what's in vs. deferred. Do not assume a feature exists just because it exists in `repo-watch-main`; check this repo's Prisma schema/routes first.

Most of `apps/api` is a near-verbatim port of `repo-watch-main/apps/api` with import paths swapped (`@repowatch/*` → `@repo-sentinel/*`) and out-of-scope features (JIRA/Atlassian, wiki sync, auto-fix, machine-client OAuth2, GitHub comment posting/resolution, chrome extension, admin RBAC UI) cut. If you need to know "how did the original handle X," `repo-watch-main` is the reference implementation — but verify the trimmed schema/enums here still support it before porting more code over.

## Dev environment on this machine

Infra runs **natively**, not via `docker-compose.yml` (that file exists as a documented alternative but isn't what's actually running):
- Postgres: native Windows service on port `5432`, database `reposentinel`, role `reposentinel`/`secret` (has `CREATEDB` for Prisma's shadow DB)
- Redis: native instance on port `6379`, **db index 1** (`redis://localhost:6379/1`) — index 0 is used by `repo-watch-main` on the same Redis instance; don't switch this to index 0 or BullMQ queues/sessions will collide with the sibling project
- API port `3101`, Web port `5175` — deliberately different from `repo-watch-main`'s `3001`/`5174` so both projects can run side by side

Secrets live in `.env` at repo root (not committed). The seeded admin login (`ADMIN_SEED_EMAIL`/`ADMIN_SEED_PASSWORD`) is also there — that account is created automatically on first API boot via `auth-seed.ts`.

Start both apps: `npm run dev` (Turborepo). Individually: `cd apps/api && npm run dev` (tsx watch) / `cd apps/web && npm run dev` (`ng serve`).

## Backend (`apps/api`) conventions

- Routes are thin: parse with Zod (`schemas/*.ts`), call a `services/*.ts` function, shape the response. Don't put business logic in route handlers.
- Every mutating route is `[requireAuth, requirePermission(Resource.X, Action.Y)]`. `Resource`/`Action` come from `@repo-sentinel/types`. The `Resource` enum here has **11** values (Connections, Dashboard, Repos, PullRequests, Reviews, Notifications, Settings, Users, Groups, Roles, Permissions) — fewer than the original's 12, since `Findings`/`Atlassian`/etc. were dropped along with their features.
- Prisma schema (`packages/db/prisma/schema.prisma`) is trimmed vs. the original — no `FindingReply`, `Atlassian*`, `ChatSession`/`ChatMessage`, `MachineClient*`, `McpActivityLog`, `UserGithubToken`, `AutoFixJob`, `WikiJiraLink`. `PostedFindingComment` was kept (forward-compat) even though nothing posts to GitHub yet in this MVP.
- Socket.IO event names/payloads intentionally match the original exactly (`review:started|queued|phase|output|complete|cancelled|deleted|failed`, `pr:new|updated|review-outdated`, `notification:new`, `poll:status`) — room pattern `review:{reviewId}`, CUID-validated. Keep parity if you touch this; the whole point is contract compatibility for a future Angular terminal/notification UI.
- `queues/run-ai-review-job.ts` is a **trimmed rewrite**, not a straight port — the original interleaves JIRA/wiki/skills/GitHub-posting logic that doesn't apply here. If you need to extend the review pipeline, start from this file's flow (clone → diff → prompt → stream CLI → parse JSON → persist), not the original's.
- `apps/api/tsconfig.json` sets `"declaration": false` — without it, `tsc` fails on `lib/auth.ts` with `TS2742` (better-auth's inferred type isn't portable without a zod-v4-core type reference). This is a real workaround, not accidental; don't re-enable declaration emit for this app without fixing that root cause first.
- No test suite is ported yet (`__tests__/` from the original wasn't carried over). `tsc --noEmit` (or `ng build` for web) is the current correctness gate.

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

- Working from the deferred-feature backlog (JIRA, GitHub comment posting, admin RBAC UI, etc.) → [ROADMAP.md](./ROADMAP.md) has the file-by-file breakdown per area, already cross-referenced against `repo-watch-main`.
- New backend route/feature not in the roadmap → check if `repo-watch-main/apps/api/src/routes/*` already has it, then adapt (not copy-paste) per the trims noted above.
- New frontend page → follow the existing `features/<domain>/<domain>-page/` structure (page component + feature `.service.ts` + any dialogs as siblings).
- Full setup/run instructions, scripts, and feature scope → [README.md](./README.md).
