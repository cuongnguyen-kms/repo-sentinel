# GitHub Comment Posting and Resolution Design

Date: 2026-07-07

## Goal

Restore the GitHub comment posting and resolution loop from RepoWatch into RepoSentinel, with full backend support and a focused PR-detail UI. A reviewer should be able to post AI findings to GitHub, track which findings are posted or resolved, carry open findings across review runs, sync GitHub thread/reply state, and understand run-over-run review changes without leaving the pull request detail page.

## Scope

Included:

- Restore backend data models and shared types needed for posted finding comments, reply tracking, resolution state, and comparison summaries.
- Add API routes and services for posting single findings, submitting selected findings as a GitHub review, listing posted comments, verifying/deleting posted comments, manually resolving findings, resolving/syncing GitHub review threads, syncing reply-based dismissals, and computing review comparisons.
- Reconnect the AI review flow to open-comment prompting: write previous open findings into the checkout before Claude runs, store the snapshot on the current review, apply Claude's open-comment resolution result after the run, and carry still-open findings forward.
- Add focused Angular PR-detail UI controls for posting/resolving findings and viewing comparison state.
- Add targeted backend and frontend tests with GitHub calls mocked.

Excluded:

- Standalone `pr-comments-page` dashboard.
- Automated scheduler for reply/thread sync.
- Broad redesign of the review UI.
- Live GitHub integration tests.

## Existing Context

RepoSentinel already has:

- `PostedFindingComment` in Prisma, but with trimmed fields and no `FindingReply`.
- `GheClient` support for single review comments, batch reviews, comment lookup/delete, commit comparison, review thread listing, and thread resolution.
- `AiReview.commitSha`, `codeReviewJson`, `diffContent`, and `findingsCount`.
- PR-detail Angular components for review history, AI review display, and diff-file rendering.
- Route and permission patterns for authenticated Fastify APIs.

The original `../repo-watch-main/repo-watch-main` source provides the reference behavior for the services/routes named in `ROADMAP.md`.

## Data Model

Update `packages/db/prisma/schema.prisma`:

- Add `AiReview.openCommentsSnapshot String? @db.Text`.
- Expand `PostedFindingComment` with:
  - `githubThreadResolved Boolean @default(false)`
  - `githubThreadResolvedAt DateTime?`
  - `dismissedAt DateTime?`
  - `dismissedBy String?`
  - `dismissalKeyword String?`
  - `replyCount Int @default(0)`
  - `lastReplyAt DateTime?`
  - `lastReplyAuthor String?`
  - `lastReplyBody String? @db.Text`
  - `repliesSyncedAt DateTime?`
  - `replies FindingReply[]`
- Add `FindingReply`:
  - `id String @id @default(cuid())`
  - `postedCommentId String`
  - `postedComment PostedFindingComment @relation(... onDelete: Cascade)`
  - `githubCommentId String @unique`
  - `githubHtmlUrl String`
  - `author String`
  - `body String @db.Text`
  - `isDismissal Boolean @default(false)`
  - `matchedKeyword String?`
  - `createdAtGithub DateTime`
  - `syncedAt DateTime @default(now())`
  - index on `postedCommentId`

Update shared enums:

- Add `Resource.Findings = "findings"`.
- Add `Resource.PrComments = "pr-comments"`.

Update shared review types and Angular DTOs with:

- `PostedFindingCommentDto`
- `FindingReplyDto`
- `ResolutionReason`
- `ReviewComparisonSummary`
- `ResolvedFindingSummary`
- `CarriedOverFindingSummary`
- `OpenCommentSummary`
- `ResolveGithubThreadsResult`
- `OpenCommentEntry`

Resolution statuses remain string-backed for compatibility:

- `OPEN`
- `RESOLVED`
- `WONT_FIX`

Resolution reasons:

- `CODE_FIX`
- `LINE_NOT_IN_DIFF`
- `NO_LONGER_FLAGGED`
- `MANUAL`
- `SUPERSEDED`

## Backend API

Add `apps/api/src/routes/review-comment-routes.ts`:

- `POST /api/pull-requests/:id/review/comments`
  - Posts one finding as a GitHub review comment.
  - Permission: `Findings/Create`.
  - Requires explicit `subjectType: "file"` for file-level comments.
- `POST /api/pull-requests/:id/review/submit`
  - Submits selected findings as one GitHub PR review.
  - Permission: `Findings/Create`.
  - Default event is `COMMENT`.
- `GET /api/pull-requests/:id/review/posted-comments`
  - Lists posted comments for a supplied `reviewId`, or the latest completed review.
  - Permission: `Findings/Read`.
- `GET /api/pull-requests/:id/review/comments/:findingId/verify`
  - Verifies whether a posted GitHub comment still exists.
  - Permission: `Findings/Read`.
- `DELETE /api/pull-requests/:id/review/comments/:findingId`
  - Deletes an individual GitHub comment when a per-comment ID exists.
  - Permission: `Findings/Delete`.

Add `apps/api/src/routes/review-resolution-routes.ts`:

- `PATCH /api/pull-requests/:id/review/findings/:findingId/resolve`
  - Marks a finding `RESOLVED` or `WONT_FIX`.
  - Creates a local `PostedFindingComment` record when the finding was never posted.
  - Permission: `Findings/Update`.
- `POST /api/pull-requests/:id/review/resolve-github-threads`
  - Resolves GitHub review threads for selected findings where per-comment IDs exist.
  - Permission: `Findings/Update`.
- `POST /api/pull-requests/:id/review/sync-github-thread-status`
  - Pulls externally resolved GitHub thread state back into DB.
  - Permission: `Findings/Read`.
- `GET /api/pull-requests/:id/review/resolution-status`
  - Returns resolution records for a review.
  - Permission: `Findings/Read`.

Add or restore:

- `POST /api/pull-requests/:id/review/sync-replies`
  - Syncs replies/dismissals for recent completed reviews of the PR.
  - Permission: `Findings/Read`.
- `GET /api/reviews/:id/comparison`
  - Returns run-over-run comparison summary.
  - Permission: `Reviews/Read`.

Register all new routes in `apps/api/src/index.ts`.

## Backend Services

`github-comment-service`:

- Resolve the target review from request `reviewId` or latest completed review.
- Use `AiReview.commitSha` for GitHub posting when available.
- Fall back to PR `headCommitSha`, and only fetch live GitHub PR data as a last resort.
- Persist posted records using `(reviewId, findingId)` upserts.
- Translate common GitHub line/path errors into user-facing messages.
- Do not silently convert inline comments to file-level comments.

`github-thread-resolution-service`:

- Map `PostedFindingComment.githubCommentId` to GitHub review thread first-comment database IDs.
- Resolve matching unresolved threads through GraphQL.
- Persist `githubThreadResolved` and `githubThreadResolvedAt`.
- Sync externally resolved thread state without changing local `resolutionStatus`.

`github-reply-sync-service`:

- Fetch all PR review comments and replies.
- Store replies in `FindingReply` by `githubCommentId`.
- Load dismissal keywords from `ai.review.dismissKeywords`.
- Mark matching posted findings as `WONT_FIX` with reason `MANUAL`.
- Update reply counters and last-reply metadata.

`open-comments-writer-service`:

- Build the open-comments JSON file from previous unresolved posted comments and unresolved local records.
- Include enough finding metadata for Claude to decide whether each item is resolved or still open.
- Store the exact snapshot on the current `AiReview.openCommentsSnapshot`.

`open-comments-resolution-service`:

- Read Claude-updated open-comments JSON after review completion.
- Accept only `RESOLVED`, `STILL_OPEN`, or null resolution values.
- Apply resolved records with reasons `CODE_FIX`, `LINE_NOT_IN_DIFF`, or `NO_LONGER_FLAGGED`.
- Carry `STILL_OPEN` GitHub-posted comments forward to the latest review.
- Create local carry-over records for unposted still-open findings.
- Propagate resolved status to matching current-run findings by fingerprint.

`finding-resolution-service`:

- Restore best-effort commit comparison based auto-resolution for outdated findings.
- This runs before a new review is queued when the PR has a previous completed review and a new head commit.
- Failures are logged and do not block review trigger.

`review-comparison-service`:

- Parse previous/current `codeReviewJson`.
- Match findings by fingerprint using `finding-fingerprint-service`.
- Return counts/details for:
  - new findings
  - carried-over findings
  - resolved findings
  - open comments resolved by the current run
  - open comments still open

## AI Review Flow

Update `triggerReview`:

- Find the previous completed review for the PR.
- If previous commit and new commit are both known, compare commits and call `resolveOutdatedFindings`.
- Continue queuing even if auto-resolution fails.

Update the review worker flow:

- Before running Claude, write open comments into the checkout and include the "Open Comments Resolution" section in the default system prompt.
- During completion processing, parse `codeReviewJson` as today.
- Apply open-comment resolutions after structured findings are available.
- Store `openCommentsSnapshot`.
- Preserve current review completion, notification, terminal log, and socket behavior.

## Frontend PR-Detail UI

Update `ReviewsService` with methods for:

- list posted comments
- post one finding
- submit selected findings
- verify/delete posted comment
- resolve/WONT_FIX finding
- resolve GitHub threads
- sync GitHub thread status
- sync replies
- fetch comparison

Update PR-detail state loading:

- Load latest review, history, posted comments, resolution status, and comparison together.
- Refresh posted/resolution/comparison data after any comment or resolution action.
- Continue polling active reviews as today.

Update `AiReviewDisplay` and `DiffFileViewer`:

- Pass posted/resolution state into file/finding rendering.
- Show per-finding controls:
  - post to GitHub
  - mark resolved
  - mark WONT_FIX
  - open GitHub comment link when posted
  - disabled/posted/resolved states
- Support selecting findings for batch submit.

Add a compact comparison summary near the review header:

- New
- Carried over
- Resolved
- Open comments resolved
- Still open

Add explicit PR-detail actions:

- submit selected findings as review
- sync GitHub thread status
- sync replies/dismissals

Do not add the standalone PR comments dashboard in this slice.

## Error Handling

Return actionable API errors for:

- PR or review not found.
- Review ID does not belong to PR.
- No completed review exists.
- GitHub line/path cannot be resolved.
- Batch-submitted comments cannot be deleted individually because no per-comment ID exists.
- GitHub comment was already deleted.
- Missing GitHub connection/token context.

API operations that mutate local and remote state should persist local DB state only after GitHub success, except deletion verification can mark a record deleted when GitHub reports it is already gone.

Open-comment resolution and auto-resolution are best-effort and must not fail a review run.

## Permissions

Seed permissions for:

- `findings:create/read/update/delete`
- `pr-comments:read`

Existing admin/system role seeding should include these in the same style as current MVP resources.

## Tests

Backend:

- Prisma generation succeeds with the restored schema.
- Route schemas reject invalid finding IDs and invalid resolution bodies.
- `github-comment-service`:
  - persists single comments after mock GitHub success
  - uses review commit SHA
  - returns friendly line/path errors
  - prevents deleting batch comments without `githubCommentId`
- `github-thread-resolution-service`:
  - resolves only comments with matching unresolved threads
  - marks skipped records correctly
- `github-reply-sync-service`:
  - upserts replies
  - marks dismissals as `WONT_FIX`
- `open-comments-resolution-service`:
  - applies `RESOLVED`
  - carries `STILL_OPEN`
  - rejects invalid entries
  - propagates resolved status by fingerprint
- `review-comparison-service`:
  - reports new, carried-over, resolved, open-resolved, and still-open counts.

Frontend:

- `ReviewsService` builds the expected API requests.
- PR-detail loads comparison and posted/resolution state.
- Finding controls reflect posted, resolved, WONT_FIX, and deleted states.
- Batch submit only sends selected findings.

## Rollout Notes

The feature changes the Prisma schema and requires a migration plus client generation. Existing `PostedFindingComment` rows should remain valid because all added fields are nullable or have defaults.

The first implementation should prefer adapting original RepoWatch files, but imports, package names, route registration, DTOs, and Angular UI must follow RepoSentinel conventions.

## Acceptance Criteria

- A completed review can post one finding to GitHub and persist its GitHub URL.
- A completed review can submit selected findings as a GitHub review.
- Posted findings display posted/resolved/WONT_FIX state in PR detail.
- A finding can be manually marked resolved or WONT_FIX.
- GitHub review threads can be resolved/synced for comments with per-comment IDs.
- GitHub replies can be synced and dismissal keywords mark findings WONT_FIX.
- A later review can resolve or carry forward previous open comments.
- Review comparison endpoint and PR-detail summary show new/carried/resolved/open-comment counts.
- Existing review trigger, terminal streaming, and review history behavior still work.
