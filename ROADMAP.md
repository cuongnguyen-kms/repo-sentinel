# Roadmap

RepoSentinel currently implements: auth/RBAC with an admin management UI (users/groups/roles/permissions), GHE connections, watched repos + polling, pull request tracking, the AI review pipeline (trigger → clone → diff → Claude CLI → streamed terminal output with live token/cost metadata → structured findings/score), configurable review prompt templates (global and per-repo overrides), GitHub comment posting & resolution, JIRA/Atlassian integration (connection, ticket browsing, AI-generated requirement checklists), and sprint reports with Google Chat reminders.

Everything below is what's still on the backlog, grouped by feature area with enough detail to pick up independently.

Nothing here blocks anything else in this list — pick whichever area is highest priority.

---

## 1. Wiki sync

Fetches design docs from a repo wiki and flags PRs that contradict them, tracking staleness.

- **Schema**: a model to track synced wiki pages and their staleness state.
- **Backend**: a wiki-sync service + scheduler, a `mismatch_design_document` finding severity added to the review pipeline's severity set, and a wiki-doc injection block added to the review prompt template.
- **Frontend**: a wiki browser page.
- **Settings**: sync interval and design-doc staleness threshold keys.

## 2. Auto-fix jobs

Lets a user trigger an AI-driven auto-fix commit for selected findings, pushed under their own GitHub identity.

- **Schema**: an auto-fix job model + status enum, and a per-user encrypted GitHub token model (for commit attribution distinct from the connection-level GHE token).
- **Backend**: job routes/schemas, a BullMQ job that applies the fix and pushes a commit, and a per-user "connect your GitHub account" token flow.
- **Frontend**: a job list page, a job detail/output page, and the GitHub-account-connect flow.

## 3. Machine-client OAuth2 (M2M auth) + satellite proxies

Lets external services authenticate via OAuth2 client-credentials and call through proxy routes; includes an admin UI for managing machine clients/groups and an activity audit log.

- **Schema**: machine client, machine group, and activity-log models.
- **Backend**: JWT signing, OAuth token routes, proxy routes for whichever downstream service(s) need it, and admin CRUD routes for machine clients/groups. Needs `bcrypt` (client secret hashing) and `jose` (JWT signing) added to `apps/api/package.json`.
- **Frontend**: admin pages for machine clients, machine groups, and the activity log.
- **Note**: this is the most standalone/optional area — only worth doing if there's a concrete external M2M consumer. Skip unless a real use case exists.

## 4. Chat sessions

Chat-style sessions (unrelated to the auth `Session`) tracked per-user, for some assistant/chat feature.

- **Schema**: chat session + chat message models.
- **Backend**: session routes/service.
- **Frontend**: a sessions list page and a session detail page.
- **Sizing**: unclear scope/value without knowing what's meant to consume these sessions — investigate and define the actual use case before committing to this.

## 5. Chrome extension support

A `/api/pull-requests/lookup` endpoint (resolve a PR by owner/repo/number) plus CORS/trusted-origin allowances for a browser extension, so a user can jump from a GitHub PR page straight into RepoSentinel.

- **Backend**: the lookup route, and dynamic `chrome-extension://` trusted-origin handling in `lib/auth.ts` (it currently hardcodes a single trusted origin).
- **Frontend**: N/A — the extension itself would be a separate artifact, not part of this app.
- **Sizing**: small, but only useful if an actual browser extension exists/matters for this project.

## Smaller gaps within already-built features

These aren't separate feature areas — they're known simplifications inside what's already built:

- **Brand theme mismatch**: the Angular Material theme is violet/magenta, but `public/assets/` brand assets are navy/terracotta. Unresolved; ask before changing.

## Suggested order

Wiki sync (#1) and auto-fix jobs (#2) are the two areas worth picking up without other constraints — both are genuine product features. Machine-client M2M (#3), chat sessions (#4), and Chrome extension support (#5) are all conditional on a concrete consumer/use case actually existing; investigate that first before investing in them.
