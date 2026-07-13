# GitHub Comment Posting and Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore GitHub AI finding posting, resolution tracking, reply dismissal sync, review comparison, and focused PR-detail controls.

**Architecture:** Port the original RepoWatch backend behavior into RepoSentinel using focused Fastify services and routes, then expose the state through existing Angular PR-detail components. Keep GitHub remote mutation services separate from local resolution/comparison services so they can be tested with mocked clients and Prisma.

**Tech Stack:** TypeScript, Prisma/PostgreSQL, Fastify, Vitest, BullMQ, Angular standalone components, Angular Material, Octokit/GitHub Enterprise client.

---

## File Structure

Schema and types:

- Modify `packages/db/prisma/schema.prisma`: restore `AiReview.openCommentsSnapshot`, full `PostedFindingComment`, and `FindingReply`.
- Create migration under `packages/db/prisma/migrations/20260707110000_github_comment_resolution/migration.sql`.
- Modify `packages/types/src/enums.ts`: add `Findings` and `PrComments`.
- Modify `packages/types/src/review-types.ts`: add posted comment, reply, resolution, open-comment, and comparison DTOs.
- Modify `apps/web/src/app/core/models/enums.ts`: mirror resource enum additions.
- Modify `apps/web/src/app/core/models/dto.ts`: mirror review/comment/comparison DTOs.

Backend schemas/routes:

- Modify `apps/api/src/schemas/review-schemas.ts`: add schemas for post comment, submit review, resolve finding, resolve threads, and reviewId query.
- Create `apps/api/src/routes/review-comment-routes.ts`: GitHub posting/list/verify/delete endpoints.
- Create `apps/api/src/routes/review-resolution-routes.ts`: manual resolution and GitHub thread sync endpoints.
- Modify `apps/api/src/routes/review-routes.ts`: add `/api/reviews/:id/comparison`.
- Modify `apps/api/src/index.ts`: register new route modules.

Backend services:

- Create `apps/api/src/services/github-comment-service.ts`: post, batch submit, list, verify, delete.
- Create `apps/api/src/services/github-thread-resolution-service.ts`: resolve/sync GitHub review threads.
- Create `apps/api/src/services/github-reply-sync-service.ts`: sync replies and dismissal keywords.
- Create `apps/api/src/services/open-comments-writer-service.ts`: generate open-comments JSON snapshot before Claude runs.
- Create `apps/api/src/services/open-comments-resolution-service.ts`: apply Claude-updated open-comment resolution output.
- Create `apps/api/src/services/finding-resolution-service.ts`: resolve outdated posted findings by commit comparison.
- Create `apps/api/src/services/review-comparison-service.ts`: compute new/carried/resolved/open-comment summary.
- Modify `apps/api/src/services/command-template-service.ts`: restore Open Comments Resolution instructions in the default system template.
- Modify `apps/api/src/services/settings-seed-service.ts`: seed `ai.review.dismissKeywords`.
- Modify `apps/api/src/services/ai-review-service.ts`: call outdated finding resolution before queueing a new review.
- Modify `apps/api/src/queues/run-ai-review-job.ts`: write open comments before Claude, apply resolutions after structured JSON parsing, persist snapshot.

Frontend:

- Modify `apps/web/src/app/features/pull-request-detail/reviews.service.ts`: add comment/resolution/comparison API methods.
- Modify `apps/web/src/app/features/pull-request-detail/pull-request-detail-page.ts`: load and refresh comparison/comment state.
- Modify `apps/web/src/app/features/pull-request-detail/pull-request-detail-page.html`: add top-level actions and comparison summary.
- Modify `apps/web/src/app/features/pull-request-detail/pull-request-detail-page.scss`: style summary/action areas.
- Modify `apps/web/src/app/features/pull-request-detail/ai-review-display/ai-review-display.ts`: accept state maps and emit finding actions/selections.
- Modify `apps/web/src/app/features/pull-request-detail/ai-review-display/ai-review-display.html`: render comparison and batch controls.
- Modify `apps/web/src/app/features/pull-request-detail/ai-review-display/ai-review-display.scss`: compact finding action layout.
- Modify `apps/web/src/app/features/pull-request-detail/diff-file-viewer/diff-file-viewer.ts`: accept posted/resolution state and emit per-finding actions.
- Modify `apps/web/src/app/features/pull-request-detail/diff-file-viewer/diff-file-viewer.html`: render per-finding controls.
- Modify `apps/web/src/app/features/pull-request-detail/diff-file-viewer/diff-file-viewer.scss`: stable button/status styling.

Tests:

- Create `apps/api/src/__tests__/review-schemas.test.ts`.
- Create `apps/api/src/__tests__/github-comment-service.test.ts`.
- Create `apps/api/src/__tests__/github-thread-resolution-service.test.ts`.
- Create `apps/api/src/__tests__/github-reply-sync-service.test.ts`.
- Create `apps/api/src/__tests__/open-comments-resolution-service.test.ts`.
- Create `apps/api/src/__tests__/review-comparison-service.test.ts`.
- Create frontend specs only if the executor first confirms the existing Angular/Vitest setup in `apps/web/src/app/app.spec.ts` can instantiate standalone components without adding new test infrastructure.

## Implementation Tasks

### Task 1: Schema, Migration, and Shared Types

**Files:**

- Modify `packages/db/prisma/schema.prisma`
- Create `packages/db/prisma/migrations/20260707110000_github_comment_resolution/migration.sql`
- Modify `packages/types/src/enums.ts`
- Modify `packages/types/src/review-types.ts`
- Modify `apps/web/src/app/core/models/enums.ts`
- Modify `apps/web/src/app/core/models/dto.ts`

- [ ] **Step 1: Write the schema changes**

Add `openCommentsSnapshot` to `AiReview`, expand `PostedFindingComment`, and add `FindingReply` exactly as specified in the design doc.

Use this Prisma shape for the new relation fields:

```prisma
model AiReview {
  openCommentsSnapshot String? @db.Text
}

model PostedFindingComment {
  githubThreadResolved   Boolean   @default(false)
  githubThreadResolvedAt DateTime?
  dismissedAt            DateTime?
  dismissedBy            String?
  dismissalKeyword       String?
  replyCount             Int       @default(0)
  lastReplyAt            DateTime?
  lastReplyAuthor        String?
  lastReplyBody          String?   @db.Text
  repliesSyncedAt        DateTime?
  replies                FindingReply[]
}

model FindingReply {
  id              String               @id @default(cuid())
  postedCommentId String
  postedComment   PostedFindingComment @relation(fields: [postedCommentId], references: [id], onDelete: Cascade)
  githubCommentId String               @unique
  githubHtmlUrl   String
  author          String
  body            String               @db.Text
  isDismissal     Boolean              @default(false)
  matchedKeyword  String?
  createdAtGithub DateTime
  syncedAt        DateTime             @default(now())

  @@index([postedCommentId])
}
```

- [ ] **Step 2: Add SQL migration**

Create the migration with equivalent SQL. Use nullable/defaulted columns only so existing rows survive.

```sql
ALTER TABLE "AiReview" ADD COLUMN "openCommentsSnapshot" TEXT;

ALTER TABLE "PostedFindingComment" ADD COLUMN "githubThreadResolved" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PostedFindingComment" ADD COLUMN "githubThreadResolvedAt" TIMESTAMP(3);
ALTER TABLE "PostedFindingComment" ADD COLUMN "dismissedAt" TIMESTAMP(3);
ALTER TABLE "PostedFindingComment" ADD COLUMN "dismissedBy" TEXT;
ALTER TABLE "PostedFindingComment" ADD COLUMN "dismissalKeyword" TEXT;
ALTER TABLE "PostedFindingComment" ADD COLUMN "replyCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PostedFindingComment" ADD COLUMN "lastReplyAt" TIMESTAMP(3);
ALTER TABLE "PostedFindingComment" ADD COLUMN "lastReplyAuthor" TEXT;
ALTER TABLE "PostedFindingComment" ADD COLUMN "lastReplyBody" TEXT;
ALTER TABLE "PostedFindingComment" ADD COLUMN "repliesSyncedAt" TIMESTAMP(3);

CREATE TABLE "FindingReply" (
  "id" TEXT NOT NULL,
  "postedCommentId" TEXT NOT NULL,
  "githubCommentId" TEXT NOT NULL,
  "githubHtmlUrl" TEXT NOT NULL,
  "author" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "isDismissal" BOOLEAN NOT NULL DEFAULT false,
  "matchedKeyword" TEXT,
  "createdAtGithub" TIMESTAMP(3) NOT NULL,
  "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FindingReply_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FindingReply_githubCommentId_key" ON "FindingReply"("githubCommentId");
CREATE INDEX "FindingReply_postedCommentId_idx" ON "FindingReply"("postedCommentId");

ALTER TABLE "FindingReply"
  ADD CONSTRAINT "FindingReply_postedCommentId_fkey"
  FOREIGN KEY ("postedCommentId") REFERENCES "PostedFindingComment"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 3: Add shared enum values**

Add these enum members in both shared and Angular enums:

```ts
Findings = "findings",
PrComments = "pr-comments",
```

- [ ] **Step 4: Add shared review DTOs**

Add type definitions in `packages/types/src/review-types.ts`, then mirror them in `apps/web/src/app/core/models/dto.ts`.

```ts
export type ResolutionStatus = "OPEN" | "RESOLVED" | "WONT_FIX";
export type ResolutionReason =
  | "CODE_FIX"
  | "LINE_NOT_IN_DIFF"
  | "NO_LONGER_FLAGGED"
  | "MANUAL"
  | "SUPERSEDED";

export interface FindingReplyDto {
  id: string;
  postedCommentId: string;
  githubCommentId: string;
  githubHtmlUrl: string;
  author: string;
  body: string;
  isDismissal: boolean;
  matchedKeyword: string | null;
  createdAtGithub: string;
  syncedAt: string;
}

export interface PostedFindingCommentDto {
  id: string;
  reviewId: string;
  findingId: string;
  githubCommentId: string | null;
  githubHtmlUrl: string;
  postedAt: string;
  deletedOnGithub: boolean;
  resolutionStatus: ResolutionStatus | null;
  resolutionReason: ResolutionReason | null;
  resolvedAt: string | null;
  resolvedByCommitSha: string | null;
  carriedFromReviewId: string | null;
  githubThreadResolved: boolean;
  githubThreadResolvedAt: string | null;
  dismissedAt: string | null;
  dismissedBy: string | null;
  dismissalKeyword: string | null;
  replyCount: number;
  lastReplyAt: string | null;
  lastReplyAuthor: string | null;
  lastReplyBody: string | null;
  repliesSyncedAt: string | null;
}
```

Also add `OpenCommentEntry`, `ReviewComparisonSummary`, `ResolvedFindingSummary`, `CarriedOverFindingSummary`, `OpenCommentSummary`, and `ResolveGithubThreadsResult` with the field names from the design doc.

- [ ] **Step 5: Generate Prisma client**

Run: `npm run db:generate`

Expected: command completes with Prisma client generated for `@repo-sentinel/db`.

- [ ] **Step 6: Build type packages**

Run: `npm run build --workspace=@repo-sentinel/types`

Expected: TypeScript build passes.

- [ ] **Step 7: Checkpoint**

Suggested commit:

```bash
git add packages/db/prisma packages/types/src apps/web/src/app/core/models
git commit -m "feat: restore finding comment schema and types"
```

### Task 2: Route Schemas and Permission Seeding

**Files:**

- Modify `apps/api/src/schemas/review-schemas.ts`
- Modify `apps/api/src/lib/auth-seed.ts`
- Modify `apps/api/src/services/settings-seed-service.ts`
- Test `apps/api/src/__tests__/review-schemas.test.ts`

- [ ] **Step 1: Add failing schema tests**

Create tests that assert valid inputs parse and invalid finding IDs/resolution bodies fail.

```ts
import { describe, expect, it } from "vitest";
import {
  postCommentBodySchema,
  resolveFindingBodySchema,
  resolveFindingParamSchema,
  resolveGithubThreadsBodySchema,
} from "../schemas/review-schemas.js";

describe("review route schemas", () => {
  it("accepts a single inline comment payload", () => {
    expect(postCommentBodySchema.safeParse({
      findingId: "F1",
      path: "src/app.ts",
      line: 12,
      body: "Finding body",
      reviewId: "review_1",
    }).success).toBe(true);
  });

  it("rejects unsafe finding ids in route params", () => {
    expect(resolveFindingParamSchema.safeParse({
      id: "pr_1",
      findingId: "../bad",
    }).success).toBe(false);
  });

  it("accepts manual and WONT_FIX resolutions only", () => {
    expect(resolveFindingBodySchema.safeParse({ reason: "MANUAL" }).success).toBe(true);
    expect(resolveFindingBodySchema.safeParse({ reason: "WONT_FIX" }).success).toBe(true);
    expect(resolveFindingBodySchema.safeParse({ reason: "CODE_FIX" }).success).toBe(false);
  });

  it("requires at least one finding id when resolving GitHub threads", () => {
    expect(resolveGithubThreadsBodySchema.safeParse({ findingIds: [] }).success).toBe(false);
    expect(resolveGithubThreadsBodySchema.safeParse({ findingIds: ["F1"] }).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run schema tests and verify failure**

Run: `npm test --workspace=@repo-sentinel/api -- review-schemas.test.ts`

Expected before implementation: FAIL because the imported schemas do not exist.

- [ ] **Step 3: Add Zod schemas**

Extend `review-schemas.ts` with the original RepoWatch schema shapes adapted to `@repo-sentinel`.

```ts
export const postCommentBodySchema = z.object({
  findingId: z.string().min(1),
  path: z.string().min(1),
  line: z.number().int().positive(),
  endLine: z.number().int().positive().optional(),
  body: z.string().min(1),
  subjectType: z.enum(["file"]).optional(),
  reviewId: z.string().min(1).optional(),
});

export const submitReviewBodySchema = z.object({
  event: z.enum(["APPROVE", "REQUEST_CHANGES", "COMMENT"]).default("COMMENT"),
  body: z.string().optional(),
  findings: z.array(z.object({
    findingId: z.string().min(1),
    path: z.string().min(1),
    line: z.number().int().positive(),
    endLine: z.number().int().positive().optional(),
    body: z.string().min(1),
  })).min(1, "At least one finding is required"),
});

export const reviewIdQuerySchema = z.object({
  reviewId: z.string().min(1).optional(),
});

export const resolveFindingParamSchema = z.object({
  id: z.string().min(1),
  findingId: z.string().min(1).max(128).regex(/^[\w\-.]+$/),
});

export const resolveFindingBodySchema = z.object({
  reason: z.enum(["MANUAL", "WONT_FIX"]).default("MANUAL"),
  reviewId: z.string().min(1).optional(),
});

export const resolveGithubThreadsBodySchema = z.object({
  findingIds: z.array(z.string().min(1)).min(1),
  reviewId: z.string().min(1).optional(),
});
```

- [ ] **Step 4: Seed permissions and dismiss keywords**

In `auth-seed.ts`, add `findings` create/read/update/delete and `pr-comments` read to the same seed path used for existing resources.

In `settings-seed-service.ts`, add:

```ts
{ key: "ai.review.dismissKeywords", value: "not fix,not a fix,invalid,wont fix,won't fix,false positive" },
```

- [ ] **Step 5: Run tests and API build**

Run: `npm test --workspace=@repo-sentinel/api -- review-schemas.test.ts`

Expected: PASS.

Run: `npm run build --workspace=@repo-sentinel/api`

Expected: PASS.

- [ ] **Step 6: Checkpoint**

Suggested commit:

```bash
git add apps/api/src/schemas/review-schemas.ts apps/api/src/lib/auth-seed.ts apps/api/src/services/settings-seed-service.ts apps/api/src/__tests__/review-schemas.test.ts
git commit -m "feat: add review comment route schemas"
```

### Task 3: GitHub Comment Posting Service and Routes

**Files:**

- Create `apps/api/src/services/github-comment-service.ts`
- Create `apps/api/src/routes/review-comment-routes.ts`
- Modify `apps/api/src/index.ts`
- Test `apps/api/src/__tests__/github-comment-service.test.ts`

- [ ] **Step 1: Add focused service tests**

Mock Prisma and GitHub client construction. Cover three behaviors: uses review commit SHA, stores posted comment after success, and blocks batch comment deletion.

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@repo-sentinel/ghe-client", () => ({
  GheClient: vi.fn().mockImplementation(() => ({
    createReviewComment: vi.fn().mockResolvedValue({ id: 123, html_url: "https://ghe/comment/123" }),
    getReviewComment: vi.fn().mockResolvedValue({ id: 123, html_url: "https://ghe/comment/123" }),
    deleteReviewComment: vi.fn().mockResolvedValue(true),
  })),
}));

vi.mock("../services/encryption-service.js", () => ({ decrypt: vi.fn(() => "plain-token") }));

describe("github-comment-service", () => {
  let prisma: any;

  beforeEach(() => {
    prisma = {
      pullRequest: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          ghePrId: 7,
          headCommitSha: "head-sha",
          repo: { owner: "acme", name: "app", connection: { hostname: "ghe.local", token: "encrypted" } },
        }),
      },
      aiReview: {
        findFirst: vi.fn().mockResolvedValue({ id: "review_1", commitSha: "review-sha" }),
      },
      postedFindingComment: {
        upsert: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn(),
      },
    };
  });

  it("posts a single finding and persists the GitHub comment", async () => {
    const { postSingleComment } = await import("../services/github-comment-service.js");
    const result = await postSingleComment(prisma, "pr_1", {
      findingId: "F1",
      path: "src/app.ts",
      line: 10,
      body: "Review comment",
      reviewId: "review_1",
    });

    expect(result).toEqual({ id: 123, html_url: "https://ghe/comment/123" });
    expect(prisma.postedFindingComment.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { reviewId_findingId: { reviewId: "review_1", findingId: "F1" } },
    }));
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test --workspace=@repo-sentinel/api -- github-comment-service.test.ts`

Expected before implementation: FAIL because `github-comment-service.ts` does not exist.

- [ ] **Step 3: Port and adapt the service**

Copy the original service from `C:\KMS\Practice\repo-watch-main\repo-watch-main\apps\api\src\services\github-comment-service.ts`, then adapt:

- `@repowatch/*` imports to `@repo-sentinel/*`.
- `PostCommentBody` and `SubmitReviewBody` imports from local schemas.
- DTO conversion to the new `@repo-sentinel/types` names.
- Error statuses using existing `ServiceError`.

Keep these exported functions:

```ts
export async function postSingleComment(
  prisma: PrismaClient,
  prId: string,
  comment: PostCommentBody
): Promise<{ id: number; html_url: string }>;

export async function submitBatchReview(
  prisma: PrismaClient,
  prId: string,
  review: SubmitReviewBody,
  log?: { error: (obj: object, msg: string) => void }
): Promise<{ id: number; html_url: string; postedCount: number }>;

export async function listPostedComments(
  prisma: PrismaClient,
  prId: string,
  reviewId?: string
): Promise<PostedFindingCommentDto[]>;

export async function verifyFindingComment(
  prisma: PrismaClient,
  prId: string,
  findingId: string,
  reviewId?: string
): Promise<{ exists: boolean; htmlUrl?: string }>;

export async function deleteFindingComment(
  prisma: PrismaClient,
  prId: string,
  findingId: string,
  reviewId?: string
): Promise<{ deleted: boolean }>;
```

- [ ] **Step 4: Add routes**

Create `review-comment-routes.ts` by adapting the original route file. Use:

```ts
import { Resource, Action } from "@repo-sentinel/types";
```

Register the routes in `apps/api/src/index.ts` after `registerReviewRoutes`.

- [ ] **Step 5: Run tests and build**

Run: `npm test --workspace=@repo-sentinel/api -- github-comment-service.test.ts`

Expected: PASS.

Run: `npm run build --workspace=@repo-sentinel/api`

Expected: PASS.

- [ ] **Step 6: Checkpoint**

Suggested commit:

```bash
git add apps/api/src/services/github-comment-service.ts apps/api/src/routes/review-comment-routes.ts apps/api/src/index.ts apps/api/src/__tests__/github-comment-service.test.ts
git commit -m "feat: add github finding comment posting"
```

### Task 4: Manual Resolution, GitHub Thread Sync, and Reply Sync

**Files:**

- Create `apps/api/src/services/github-thread-resolution-service.ts`
- Create `apps/api/src/services/github-reply-sync-service.ts`
- Create `apps/api/src/routes/review-resolution-routes.ts`
- Modify `apps/api/src/index.ts`
- Test `apps/api/src/__tests__/github-thread-resolution-service.test.ts`
- Test `apps/api/src/__tests__/github-reply-sync-service.test.ts`

- [ ] **Step 1: Write failing thread resolution tests**

Test that only comments with GitHub comment IDs and matching unresolved GitHub threads are resolved.

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@repo-sentinel/ghe-client", () => ({
  GheClient: vi.fn().mockImplementation(() => ({
    listReviewThreads: vi.fn().mockResolvedValue([
      { threadNodeId: "thread_1", isResolved: false, firstCommentDatabaseId: 123 },
    ]),
    resolveReviewThread: vi.fn().mockResolvedValue(true),
  })),
}));

vi.mock("../services/encryption-service.js", () => ({ decrypt: vi.fn(() => "plain-token") }));

describe("github-thread-resolution-service", () => {
  it("resolves matching unresolved GitHub threads", async () => {
    const prisma: any = {
      aiReview: { findFirst: vi.fn().mockResolvedValue({ id: "review_1" }) },
      postedFindingComment: {
        findMany: vi.fn().mockResolvedValue([{ findingId: "F1", githubCommentId: "123" }]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      pullRequest: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          ghePrId: 5,
          repo: { owner: "acme", name: "app", connection: { hostname: "ghe.local", token: "enc" } },
        }),
      },
    };
    const { resolveGithubThreads } = await import("../services/github-thread-resolution-service.js");
    await expect(resolveGithubThreads(prisma, "pr_1", ["F1"], "review_1"))
      .resolves.toMatchObject({ resolved: 1, failed: 0, skipped: 0 });
  });
});
```

- [ ] **Step 2: Write failing reply sync tests**

Mock `global.fetch` to return a top-level comment and a reply containing a dismissal keyword. Assert `findingReply.upsert` and posted comment WONT_FIX update happen.

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/encryption-service.js", () => ({ decrypt: vi.fn(() => "plain-token") }));

describe("github-reply-sync-service", () => {
  afterEach(() => vi.restoreAllMocks());

  it("stores dismissal replies and marks finding WONT_FIX", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => "" },
      json: async () => [
        { id: 123, body: "[RepoSentinel] finding", html_url: "https://ghe/c/123", user: { login: "bot" } },
        { id: 124, in_reply_to_id: 123, body: "false positive", html_url: "https://ghe/c/124", user: { login: "dev" }, created_at: "2026-07-07T00:00:00Z" },
      ],
    }));
    const prisma: any = {
      aiReview: { findUnique: vi.fn().mockResolvedValue({ pullRequest: { ghePrId: 5, repo: { owner: "acme", name: "app", connection: { hostname: "github.com", token: "enc" } } } }) },
      appSetting: { findUnique: vi.fn().mockResolvedValue({ value: "false positive" }) },
      postedFindingComment: {
        findMany: vi.fn().mockResolvedValue([{ id: "pfc_1", githubCommentId: "123", githubHtmlUrl: "https://ghe/c/123", replyCount: 0 }]),
        update: vi.fn().mockResolvedValue({}),
      },
      findingReply: { upsert: vi.fn().mockResolvedValue({}) },
    };
    const { syncRepliesForReview } = await import("../services/github-reply-sync-service.js");
    const result = await syncRepliesForReview(prisma, "review_1");
    expect(result.dismissed).toBe(1);
    expect(prisma.findingReply.upsert).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
npm test --workspace=@repo-sentinel/api -- github-thread-resolution-service.test.ts github-reply-sync-service.test.ts
```

Expected before implementation: FAIL because services do not exist.

- [ ] **Step 4: Port services and route**

Adapt these original files:

- `github-thread-resolution-service.ts`
- `github-reply-sync-service.ts`
- `review-resolution-routes.ts`

Add a `POST /api/pull-requests/:id/review/sync-replies` route either in `review-resolution-routes.ts` or a small separate route module. Prefer `review-resolution-routes.ts` for this slice because it shares the same permission surface.

- [ ] **Step 5: Run tests and build**

Run:

```bash
npm test --workspace=@repo-sentinel/api -- github-thread-resolution-service.test.ts github-reply-sync-service.test.ts
npm run build --workspace=@repo-sentinel/api
```

Expected: PASS.

- [ ] **Step 6: Checkpoint**

Suggested commit:

```bash
git add apps/api/src/services/github-thread-resolution-service.ts apps/api/src/services/github-reply-sync-service.ts apps/api/src/routes/review-resolution-routes.ts apps/api/src/index.ts apps/api/src/__tests__/github-thread-resolution-service.test.ts apps/api/src/__tests__/github-reply-sync-service.test.ts
git commit -m "feat: add finding resolution and reply sync"
```

### Task 5: Open Comments Writer and Resolution Services

**Files:**

- Create `apps/api/src/services/open-comments-writer-service.ts`
- Create `apps/api/src/services/open-comments-resolution-service.ts`
- Test `apps/api/src/__tests__/open-comments-resolution-service.test.ts`

- [ ] **Step 1: Write failing open-comment resolution tests**

Use a temp directory and a fake Prisma object to verify `RESOLVED`, `STILL_OPEN`, and invalid entries.

```ts
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { OPEN_COMMENTS_FILENAME } from "../services/open-comments-writer-service.js";

describe("open-comments-resolution-service", () => {
  it("applies resolved entries and carries still-open entries", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-comments-"));
    await writeFile(join(dir, OPEN_COMMENTS_FILENAME), JSON.stringify([
      { commentId: "pfc_1", findingId: "F1", title: "Bug", file: "src/a.ts", line: 10, severity: "high", comment: "Bug", status: "OPEN", resolution: "RESOLVED", resolutionReason: "CODE_FIX" },
      { commentId: "pfc_2", findingId: "F2", title: "Still", file: "src/b.ts", line: 20, severity: "medium", comment: "Still", status: "OPEN", resolution: "STILL_OPEN", resolutionReason: null },
    ]));
    const prisma: any = {
      postedFindingComment: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue({ id: "pfc_2", reviewId: "old_review", findingId: "F2", githubCommentId: "222", githubHtmlUrl: "https://ghe/c/222", postedAt: new Date(), deletedOnGithub: false, resolutionStatus: "OPEN" }),
        delete: vi.fn().mockResolvedValue({}),
        upsert: vi.fn().mockResolvedValue({}),
      },
      $transaction: vi.fn(async (ops: unknown[]) => ops),
    };
    const { applyOpenCommentResolutions } = await import("../services/open-comments-resolution-service.js");
    const result = await applyOpenCommentResolutions(prisma, dir, "new-sha", { reviewId: "new_review", findings: [] });
    expect(result).toMatchObject({ resolved: 1, stillOpen: 1, carriedOver: 1 });
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test --workspace=@repo-sentinel/api -- open-comments-resolution-service.test.ts`

Expected before implementation: FAIL because services do not exist.

- [ ] **Step 3: Port and adapt services**

Adapt original:

- `open-comments-writer-service.ts`
- `open-comments-resolution-service.ts`

Use `@repo-sentinel/db` and `@repo-sentinel/types` imports. Keep the exported constant:

```ts
export const OPEN_COMMENTS_FILENAME = "manager-hub-open-comments.json";
```

Use the existing `finding-fingerprint-service.ts` `hashFingerprint` helper for matching and carry-over IDs.

- [ ] **Step 4: Run tests and build**

Run:

```bash
npm test --workspace=@repo-sentinel/api -- open-comments-resolution-service.test.ts
npm run build --workspace=@repo-sentinel/api
```

Expected: PASS.

- [ ] **Step 5: Checkpoint**

Suggested commit:

```bash
git add apps/api/src/services/open-comments-writer-service.ts apps/api/src/services/open-comments-resolution-service.ts apps/api/src/__tests__/open-comments-resolution-service.test.ts
git commit -m "feat: apply open comment resolution results"
```

### Task 6: Review Comparison Service and Endpoint

**Files:**

- Create `apps/api/src/services/review-comparison-service.ts`
- Modify `apps/api/src/routes/review-routes.ts`
- Test `apps/api/src/__tests__/review-comparison-service.test.ts`

- [ ] **Step 1: Write failing comparison tests**

Test new/carried-over/resolved counts from two reviews.

```ts
import { describe, expect, it, vi } from "vitest";

describe("review-comparison-service", () => {
  it("reports new and carried-over findings", async () => {
    const previousJson = JSON.stringify({ findings: [{ id: "F1", file: "src/a.ts", line: 1, severity: "high", title: "Bug", comment: "Bug" }] });
    const currentJson = JSON.stringify({ findings: [
      { id: "F1", file: "src/a.ts", line: 1, severity: "high", title: "Bug", comment: "Bug" },
      { id: "F2", file: "src/b.ts", line: 2, severity: "medium", title: "New", comment: "New" },
    ] });
    const prisma: any = {
      aiReview: {
        findUnique: vi.fn().mockResolvedValue({ id: "current", pullRequestId: "pr_1", codeReviewJson: currentJson, createdAt: new Date("2026-07-07T01:00:00Z"), commitSha: "sha2", openCommentsSnapshot: null }),
        findFirst: vi.fn().mockResolvedValue({ id: "previous", codeReviewJson: previousJson }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      postedFindingComment: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const { computeReviewComparison } = await import("../services/review-comparison-service.js");
    const result = await computeReviewComparison(prisma, "current");
    expect(result.newCount).toBe(1);
    expect(result.carriedOverCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test --workspace=@repo-sentinel/api -- review-comparison-service.test.ts`

Expected before implementation: FAIL because service does not exist.

- [ ] **Step 3: Port service and add endpoint**

Adapt original `review-comparison-service.ts`.

In `review-routes.ts`, add:

```ts
app.get(
  "/api/reviews/:id/comparison",
  { preHandler: [requireAuth, requirePermission(Resource.Reviews, Action.Read)] },
  async (request, reply) => {
    const parsed = reviewIdParamSchema.safeParse(request.params);
    if (!parsed.success) { handleZodError(parsed.error, reply); return; }
    const data = await computeReviewComparison(app.prisma, parsed.data.id);
    reply.send({ success: true, data });
  }
);
```

- [ ] **Step 4: Run tests and build**

Run:

```bash
npm test --workspace=@repo-sentinel/api -- review-comparison-service.test.ts
npm run build --workspace=@repo-sentinel/api
```

Expected: PASS.

- [ ] **Step 5: Checkpoint**

Suggested commit:

```bash
git add apps/api/src/services/review-comparison-service.ts apps/api/src/routes/review-routes.ts apps/api/src/__tests__/review-comparison-service.test.ts
git commit -m "feat: add review comparison endpoint"
```

### Task 7: AI Review Flow Integration

**Files:**

- Create `apps/api/src/services/finding-resolution-service.ts`
- Modify `apps/api/src/services/ai-review-service.ts`
- Modify `apps/api/src/queues/run-ai-review-job.ts`
- Modify `apps/api/src/services/command-template-service.ts`

- [ ] **Step 1: Port outdated finding resolution**

Adapt original `finding-resolution-service.ts` and import `GheCompareFile` from `@repo-sentinel/ghe-client`.

Keep exported function:

```ts
export async function resolveOutdatedFindings(
  prisma: PrismaClient,
  previousReviewId: string,
  newCommitSha: string,
  compareFiles: GheCompareFile[],
  log?: { info: (msg: string) => void; warn: (msg: string) => void }
): Promise<{ resolved: number; total: number }>;
```

- [ ] **Step 2: Integrate auto-resolution in `triggerReview`**

Before creating the new queued review, load latest completed review with commit SHA. If previous review commit differs from new `commitSha`, call `GheClient.compareCommits` and `resolveOutdatedFindings`. Wrap this in `try/catch` and log warnings without blocking the trigger.

- [ ] **Step 3: Restore Open Comments Resolution prompt section**

Append an Open Comments Resolution section to `DEFAULT_SYSTEM_TEMPLATE` instructing Claude to read `manager-hub-open-comments.json`, update each entry's `resolution`, `resolutionReason`, and `updatedLine`, and leave WONT_FIX entries unchanged.

- [ ] **Step 4: Write open-comments file before Claude runs**

In `run-ai-review-job.ts`, after stale file cleanup and before building the prompt, call the writer service. Capture the snapshot string and later persist it on the review.

Use this integration shape:

```ts
const openCommentsSnapshot = await writeOpenCommentsFile(fastify.prisma, prId, reviewId, repoPath, log);
```

- [ ] **Step 5: Apply open-comment resolutions after JSON parsing**

After `computeFingerprints(codeReviewResult.findings)`, call:

```ts
const resolutionResult = codeReviewResult
  ? await applyOpenCommentResolutions(
      fastify.prisma,
      repoPath,
      commitSha,
      { reviewId, findings: codeReviewResult.findings },
      log
    )
  : null;
```

Log counts if `resolutionResult` is not null. Persist `openCommentsSnapshot` in the completed `AiReview.update`.

- [ ] **Step 6: Run API build**

Run: `npm run build --workspace=@repo-sentinel/api`

Expected: PASS.

- [ ] **Step 7: Checkpoint**

Suggested commit:

```bash
git add apps/api/src/services/finding-resolution-service.ts apps/api/src/services/ai-review-service.ts apps/api/src/queues/run-ai-review-job.ts apps/api/src/services/command-template-service.ts
git commit -m "feat: wire open comment resolution into reviews"
```

### Task 8: Frontend Service and DTO Integration

**Files:**

- Modify `apps/web/src/app/features/pull-request-detail/reviews.service.ts`
- Modify `apps/web/src/app/core/models/dto.ts`

- [ ] **Step 1: Add API methods**

Add methods to `ReviewsService`:

```ts
async listPostedComments(prId: string, reviewId?: string): Promise<PostedFindingCommentDto[]> {
  const query = reviewId ? `?reviewId=${encodeURIComponent(reviewId)}` : '';
  const res = await firstValueFrom(
    this.http.get<ApiResponse<PostedFindingCommentDto[]>>(`/api/pull-requests/${prId}/review/posted-comments${query}`)
  );
  return res.data;
}

async postFindingComment(prId: string, body: PostCommentRequest): Promise<{ id: number; html_url: string }> {
  const res = await firstValueFrom(
    this.http.post<ApiResponse<{ id: number; html_url: string }>>(`/api/pull-requests/${prId}/review/comments`, body)
  );
  return res.data;
}

async submitReview(prId: string, body: SubmitReviewRequest): Promise<{ id: number; html_url: string; postedCount: number }> {
  const res = await firstValueFrom(
    this.http.post<ApiResponse<{ id: number; html_url: string; postedCount: number }>>(`/api/pull-requests/${prId}/review/submit`, body)
  );
  return res.data;
}

async resolveFinding(prId: string, findingId: string, body: ResolveFindingRequest): Promise<{ resolved: number }> {
  const res = await firstValueFrom(
    this.http.patch<ApiResponse<{ resolved: number }>>(`/api/pull-requests/${prId}/review/findings/${findingId}/resolve`, body)
  );
  return res.data;
}

async resolveGithubThreads(prId: string, findingIds: string[], reviewId?: string): Promise<ResolveGithubThreadsResult> {
  const res = await firstValueFrom(
    this.http.post<ApiResponse<ResolveGithubThreadsResult>>(`/api/pull-requests/${prId}/review/resolve-github-threads`, { findingIds, reviewId })
  );
  return res.data;
}

async syncGithubThreadStatus(prId: string, reviewId?: string): Promise<{ synced: number }> {
  const query = reviewId ? `?reviewId=${encodeURIComponent(reviewId)}` : '';
  const res = await firstValueFrom(
    this.http.post<ApiResponse<{ synced: number }>>(`/api/pull-requests/${prId}/review/sync-github-thread-status${query}`, {})
  );
  return res.data;
}

async syncReplies(prId: string): Promise<{ synced: number; dismissed: number; reopened: number; errors: number }> {
  const res = await firstValueFrom(
    this.http.post<ApiResponse<{ synced: number; dismissed: number; reopened: number; errors: number }>>(`/api/pull-requests/${prId}/review/sync-replies`, {})
  );
  return res.data;
}

async getComparison(reviewId: string): Promise<ReviewComparisonSummary> {
  const res = await firstValueFrom(
    this.http.get<ApiResponse<ReviewComparisonSummary>>(`/api/reviews/${reviewId}/comparison`)
  );
  return res.data;
}
```

Use `HttpClient` and `firstValueFrom` in the same style as existing methods.

- [ ] **Step 2: Run web build**

Run: `npm run build --workspace=@repo-sentinel/web`

Expected: PASS.

- [ ] **Step 3: Checkpoint**

Suggested commit:

```bash
git add apps/web/src/app/features/pull-request-detail/reviews.service.ts apps/web/src/app/core/models/dto.ts
git commit -m "feat: add review comment frontend API methods"
```

### Task 9: PR-Detail State and Top-Level Actions

**Files:**

- Modify `apps/web/src/app/features/pull-request-detail/pull-request-detail-page.ts`
- Modify `apps/web/src/app/features/pull-request-detail/pull-request-detail-page.html`
- Modify `apps/web/src/app/features/pull-request-detail/pull-request-detail-page.scss`

- [ ] **Step 1: Add PR-detail state**

Add signals:

```ts
readonly postedComments = signal<PostedFindingCommentDto[]>([]);
readonly comparison = signal<ReviewComparisonSummary | null>(null);
readonly selectedFindingIds = signal<Set<string>>(new Set());
readonly actionBusy = signal(false);
```

Load posted comments and comparison after latest review is loaded and completed.

- [ ] **Step 2: Add refresh helper**

Create:

```ts
private async refreshReviewMetadata(review: AiReviewDto | null): Promise<void> {
  if (!review || review.status !== 'COMPLETED') {
    this.postedComments.set([]);
    this.comparison.set(null);
    return;
  }
  const [posted, comparison] = await Promise.all([
    this.reviewsService.listPostedComments(this.prId, review.id),
    this.reviewsService.getComparison(review.id),
  ]);
  this.postedComments.set(posted);
  this.comparison.set(comparison);
}
```

- [ ] **Step 3: Add action handlers**

Implement handlers for post, resolve, WONT_FIX, sync thread status, sync replies, selection change, and submit selected. Each handler should set `actionBusy`, call the service, then refresh metadata.

- [ ] **Step 4: Render top-level summary and actions**

Add a compact summary block with five counts from `comparison()` and buttons for sync thread status, sync replies, and submit selected.

- [ ] **Step 5: Run web build**

Run: `npm run build --workspace=@repo-sentinel/web`

Expected: PASS.

- [ ] **Step 6: Checkpoint**

Suggested commit:

```bash
git add apps/web/src/app/features/pull-request-detail/pull-request-detail-page.*
git commit -m "feat: show review comparison controls"
```

### Task 10: Finding Controls in Review Display and Diff Viewer

**Files:**

- Modify `apps/web/src/app/features/pull-request-detail/ai-review-display/ai-review-display.ts`
- Modify `apps/web/src/app/features/pull-request-detail/ai-review-display/ai-review-display.html`
- Modify `apps/web/src/app/features/pull-request-detail/ai-review-display/ai-review-display.scss`
- Modify `apps/web/src/app/features/pull-request-detail/diff-file-viewer/diff-file-viewer.ts`
- Modify `apps/web/src/app/features/pull-request-detail/diff-file-viewer/diff-file-viewer.html`
- Modify `apps/web/src/app/features/pull-request-detail/diff-file-viewer/diff-file-viewer.scss`

- [ ] **Step 1: Add inputs and outputs**

In `AiReviewDisplay`, add inputs for `postedComments`, `selectedFindingIds`, and `actionBusy`; outputs for post, resolve, WONT_FIX, selected change, and submit selected.

In `DiffFileViewer`, add the same per-finding state inputs and per-finding outputs.

- [ ] **Step 2: Build lookup helpers**

Build maps keyed by `findingId` for posted/resolution state. Treat `deletedOnGithub` as not posted for post button enablement.

- [ ] **Step 3: Render controls**

For each finding, render:

- checkbox for batch selection
- "Post" button
- "Resolve" button
- "WONT_FIX" button
- GitHub comment link when `githubHtmlUrl` is non-empty
- status label for `RESOLVED`, `WONT_FIX`, `OPEN`, and GitHub thread resolved

Use Angular Material buttons/icons already imported or add the needed modules locally.

- [ ] **Step 4: Wire parent-child events**

Pass handler outputs from `PullRequestDetailPage` to `AiReviewDisplay`, and from `AiReviewDisplay` to each `DiffFileViewer`.

- [ ] **Step 5: Run web build**

Run: `npm run build --workspace=@repo-sentinel/web`

Expected: PASS.

- [ ] **Step 6: Checkpoint**

Suggested commit:

```bash
git add apps/web/src/app/features/pull-request-detail/ai-review-display apps/web/src/app/features/pull-request-detail/diff-file-viewer
git commit -m "feat: add finding comment controls"
```

### Task 11: Final Verification

**Files:** no planned edits unless verification finds issues.

- [ ] **Step 1: Generate Prisma client**

Run: `npm run db:generate`

Expected: PASS.

- [ ] **Step 2: Run API tests**

Run: `npm test --workspace=@repo-sentinel/api`

Expected: PASS.

- [ ] **Step 3: Build API**

Run: `npm run build --workspace=@repo-sentinel/api`

Expected: PASS.

- [ ] **Step 4: Build web**

Run: `npm run build --workspace=@repo-sentinel/web`

Expected: PASS.

- [ ] **Step 5: Run full workspace build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 6: Manual smoke test**

Start API/web using the repo's normal dev workflow. In a PR with a completed review:

1. Open the PR detail page.
2. Confirm comparison counts render.
3. Post one finding to GitHub.
4. Confirm the finding shows a GitHub link.
5. Mark one finding WONT_FIX.
6. Sync replies and thread status without errors.

- [ ] **Step 7: Final checkpoint**

Suggested commit:

```bash
git status --short
git commit -m "feat: complete github comment resolution workflow"
```

Only run the final commit if there are remaining staged changes that were not committed by earlier checkpoints.

## Self-Review

Spec coverage:

- Schema and shared DTO restoration: Task 1.
- Routes and schemas: Tasks 2, 3, 4, and 6.
- GitHub posting/list/verify/delete: Task 3.
- Manual resolution, GitHub thread sync, reply dismissal: Task 4.
- Open-comments prompt and review lifecycle integration: Tasks 5 and 7.
- Review comparison: Task 6.
- Focused PR-detail UI: Tasks 8, 9, and 10.
- Tests and verification: included in each task plus Task 11.

Placeholder scan:

- Placeholder scan completed with no executable-task placeholders found.

Type consistency:

- DTO names match the design doc and are introduced before service/UI tasks use them.
- API method names in frontend tasks match backend route responsibilities.
- Service names match the file map and spec.
