# Roadmap to full parity with RepoWatch

RepoSentinel currently implements the MVP slice described in [README.md § Scope](./README.md#scope): auth/RBAC, GHE connections, watched repos + polling, pull request tracking, and the core AI review pipeline (trigger → clone → diff → Claude CLI → streamed output → structured findings/score). Everything below is what's still missing to reach full feature parity with the original `../repo-watch-main` project, grouped by feature area with enough detail to pick up independently. Reference file paths are in `repo-watch-main` unless noted.

Each section lists: what it does, the backend pieces to port/adapt, the frontend pieces to build, and what's already in place here (if anything) vs. what needs restoring first (Prisma models, `Resource` enum values).

Nothing here blocks anything else in this list — pick whichever area is highest priority.

---

## 1. GitHub comment posting & resolution

Posts AI review findings back to the PR as GitHub review comments, tracks their resolution status across review runs, and syncs reply-based dismissals.

- **Restore in schema**: `FindingReply` model (dropped from `packages/db/prisma/schema.prisma`); `PostedFindingComment` already exists here but its `replies` relation and dismissal fields were trimmed — check the original model for the full field set.
- **Backend**: `routes/review-comment-routes.ts`, `routes/review-resolution-routes.ts`, `services/github-comment-service.ts`, `services/github-reply-sync-service.ts`, `services/github-thread-resolution-service.ts`, `services/open-comments-resolution-service.ts`, `services/open-comments-writer-service.ts`, `services/finding-resolution-service.ts`, `services/review-comparison-service.ts` (also restores the `/api/reviews/:id/comparison` endpoint, which was cut from `apps/api/src/routes/review-routes.ts` here).
- **Also restores**: the `resolveOutdatedFindings` step that was removed from `ai-review-service.ts::triggerReview` in this repo, and the "Open Comments Resolution" section that was stripped from `command-template-service.ts`'s default prompt template (see original `DEFAULT_SYSTEM_TEMPLATE`).
- **Frontend**: `pr-comments-page` (dashboard of posted comments across PRs), plus the PR-detail review UI needs a "post to GitHub" action, per-finding resolve/reject controls, and the run-over-run comparison summary (new/carried-over/resolved finding counts) — see original `code-review-section.tsx`, `diff-file-viewer.tsx` for the interaction model to replicate in Angular.
- **Resource enum**: add back `PrComments` (and reuse existing `Findings`... actually `Findings` was also dropped — re-add both to `packages/types/src/enums.ts`).

## 2. JIRA / Atlassian integration

Links PRs to JIRA tickets, injects ticket context + checklists into the AI review prompt, and tracks Atlassian user activity (worklogs, comments) for sprint reporting.

- **Restore in schema**: `AtlassianConnection`, `WatchedAtlassianUser`, `AtlassianActivityLog`, `AtlassianActivityType` enum.
- **Backend**: `routes/atlassian-connection-routes.ts`, `routes/atlassian-activity-routes.ts`, `routes/atlassian-user-routes.ts`, `routes/jira-routes.ts`, `services/atlassian-connection-service.ts`, `services/atlassian-sync-service.ts`, `services/atlassian-api-client-service.ts`, `services/atlassian-activity-service.ts`, `services/jira-ticket-service.ts`, `services/jira-checklist-service.ts`, `queues/atlassian-sync-scheduler.ts`. Also restores `utils/hostname-validation.ts::validateAtlassianHostname` (present in the original, trimmed out of this repo's copy since only GHE hostname validation was needed).
- **Prompt integration**: re-adds the JIRA ticket-pattern detection + checklist injection to `command-template-service.ts`'s template building, and the `mismatch_requirement` / `checklist_required` severities that were removed from `code-review-json-parser.ts` and `packages/types/src/review-types.ts`'s `FindingSeverity`.
- **Frontend**: `jira-page` (ticket/checklist browser), connection form for Atlassian (parallel to the existing GHE connection dialog).
- **Resource enum**: add back `Atlassian`.

## 3. Wiki sync

Fetches design docs from a repo wiki and flags PRs that contradict them (`mismatch_design_document` severity), tracks staleness.

- **Backend**: `routes/wiki-routes.ts`, `services/wiki-sync-service.ts`, `queues/wiki-sync-scheduler.ts`. Also restores the `mismatch_design_document` severity in `code-review-json-parser.ts` / `review-types.ts` and the wiki-doc injection block in the review prompt.
- **Frontend**: `wiki-page`.
- **Settings**: `wiki.syncIntervalMinutes`, `ai.review.designDocStaleDays` (were in the original `settings-seed-service.ts`, cut from this repo's trimmed version).

## 4. Auto-fix jobs

Lets a user trigger an AI-driven auto-fix commit for selected findings, pushed under their own GitHub identity.

- **Restore in schema**: `AutoFixJob`, `AutoFixStatus` enum, `UserGithubToken` (per-user encrypted GitHub token for commit attribution).
- **Backend**: `routes/auto-fix-routes.ts`, `routes/user-github-token-routes.ts`, `schemas/auto-fix-schemas.ts`, `queues/run-auto-fix-job.ts`, `queues/auto-fix-queue.ts`.
- **Frontend**: `auto-fix-page` (job list), `auto-fix-detail-page` (job detail/output), a "connect your GitHub account" flow for the per-user token.
- **Resource enum**: add back `AutoFix`.

## 5. Machine-client OAuth2 (M2M auth) + satellite proxies

Lets external services (e.g. an internal Firebase/repo-intelligence tool) authenticate via OAuth2 client-credentials and calls through proxy routes; includes an admin UI for managing machine clients/groups and an MCP activity audit log.

- **Restore in schema**: `MachineClient`, `McpActivityLog`, `MachineClientAuditLog`, `MachineGroup`, `MachineGroupPermission`.
- **Backend**: `lib/jwt-signing-service.ts`, `routes/oauth-token-routes.ts`, `routes/admin-machine-client-routes.ts`, `routes/admin-machine-group-routes.ts`, `routes/admin-mcp-activity-routes.ts`, `routes/repo-indexing-proxy-routes.ts`, `routes/firebase-environments-proxy-routes.ts`, `routes/mcp-verify-routes.ts`, `services/machine-client-service.ts`, `services/machine-group-service.ts`, `services/mcp-activity-cleanup-service.ts`, `services/mcp-activity-subscriber-service.ts`. Needs `bcrypt` (client secret hashing) and `jose` (JWT signing) back in `apps/api/package.json` — both were deliberately dropped from this repo.
- **Frontend**: admin pages for machine clients / machine groups / MCP activity log, plus a `repo-indexing-page` if the RepoSphere proxy is restored.
- **Resource enum**: add back `MachineClients`, `MachineGroups`, `McpActivity`, `Firebase`, `RepoIndexing`.
- **Note**: this is the most standalone/optional area — only worth doing if an external M2M consumer actually needs it. Skip unless there's a concrete use case.

## 6. Admin RBAC management UI

CRUD UI for users, groups, roles, and permissions. The RBAC data model and `Resource` enum values (`Users`, `Groups`, `Roles`, `Permissions`) are **already present** in this repo (kept intentionally for forward-compat) — only the routes, services, and frontend pages are missing.

- **Backend**: `routes/admin-user-routes.ts`, `routes/admin-group-routes.ts`, `routes/admin-role-routes.ts`, `routes/admin-permission-routes.ts`, `services/user-service.ts`, `services/group-service.ts`, `services/role-service.ts`. `services/permission-service.ts` already exists here (read-side); these add the write-side CRUD + cache invalidation (`invalidatePermissionCache`/`invalidateGroupPermissionCache`, already present in this repo's `permission-service.ts`).
- **Frontend**: `admin/admin-users-page`, `admin/admin-groups-page`, `admin/admin-roles-page`, `admin/admin-permissions-page`, gated by an `AdminGuard` (role === "admin") — the Angular routing/guard pattern already exists here for the authenticated shell, just needs an `/admin/*` branch added to `app.routes.ts`.
- **Sizing**: medium — mostly straightforward CRUD forms/tables, reusing the connections/repositories page patterns already built here.

## 7. Chat sessions

Chat-style sessions (unrelated to better-auth `Session`) tracked per-user with sprint-based filtering, used for some assistant/chat feature in the original.

- **Restore in schema**: `ChatSession`, `ChatMessage`.
- **Backend**: `routes/session-routes.ts`, `services/session-service.ts` (note: this repo's `Resource` enum currently has no `Sessions` value — the comment in the original enum says "Chat sessions"; add it back).
- **Frontend**: `sessions-page`, `session-detail-page`.
- **Sizing**: unclear scope/value without knowing what consumes these sessions in the original — investigate `repo-watch-main`'s session-service.ts usage before committing to this.

## 8. Sprint reports & reminders

Aggregates JIRA sprint data + AI review coverage into a report view; sends scheduled Google Chat reminders for tickets missing review or merged PRs with open comments.

- **Backend**: `routes/report-routes.ts`, `services/sprint-reminder-service.ts`, `queues/sprint-reminder-scheduler.ts`, `services/google-chat-service.ts` (also wire back into `notification-service.ts::emitPrUpdated`'s `sendMergedPrReminder` call, which was removed from this repo's copy). Depends on JIRA integration (#2) being in place first for the sprint/ticket data.
- **Frontend**: `report-page`.
- **Settings**: `report.sprintStartDate`, `report.sprintLengthDays`, `ai.review.googleChat*`, `ai.review.sprintReminderEnabled`, `ai.review.reminderTime*` keys (all cut from this repo's `settings-seed-service.ts`).

## 9. Chrome extension support

A `/api/pull-requests/lookup` endpoint (resolve a PR by owner/repo/number) and CORS/trusted-origin allowances for a browser extension, used to jump from a GitHub PR page into RepoWatch.

- **Backend**: `routes/chrome-extension-routes.ts`, the `/lookup` route on `pull-requests-routes.ts` (removed here), and the `chrome-extension://` trusted-origin handling in `lib/auth.ts` (this repo's `auth.ts` hardcodes a single trusted origin instead of the original's dynamic origin-extraction logic).
- **Frontend**: N/A (the extension itself is a separate artifact, not part of this app).
- **Sizing**: small, but only useful if the actual browser extension exists/matters for this project.

## Smaller gaps within already-built features

These aren't separate feature areas — they're known simplifications inside the MVP that's already built:

- **Terminal UI**: the PR-detail review terminal currently renders `review:output` as a plain scrolling `<pre>` block. The original uses `@xterm/xterm` + `@xterm/addon-fit` for a real terminal (ANSI colors, scrollback). Upgrading is presentation-only — the Socket.IO event contract is already identical, so this is a frontend-only swap in `features/pull-request-detail/ai-review-terminal-panel/`.
- **Settings page**: only exposes the `ai.review.*` core keys (timeout, maxFiles, maxDiffSize, model, autoReview*). The backend `settings-routes.ts`/`settings-service.ts` here are generic key-value (same as the original) and will happily store any key — the settings *page* just doesn't render fields for JIRA/wiki/Google Chat keys yet because those features don't exist. Extend the settings page alongside whichever feature area needs new keys, not in isolation.
- **Brand theme mismatch**: flagged in `CLAUDE.md` — the Angular Material theme is violet/magenta, but `public/assets/` brand assets are navy/terracotta. Unresolved; ask before changing.

## Suggested order

If picking work up without other constraints, a reasonable order by "value per effort" and dependency chain:

1. **Admin RBAC UI** (#6) — schema/enum already in place, no new Prisma models, unlocks proper user management instead of manual DB edits.
2. **GitHub comment posting & resolution** (#1) — completes the core AI-review loop (findings currently have nowhere to go but the UI).
3. **Terminal UI upgrade** (xterm.js) — cheap, high-visible-polish, no backend changes.
4. **JIRA integration** (#2) — meaningfully improves review quality (ticket context), and is a prerequisite for sprint reports (#8).
5. Everything else (wiki sync, auto-fix, machine-client M2M, chat sessions, chrome extension) — pick based on actual need; none block each other.
