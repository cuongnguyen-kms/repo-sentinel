# JIRA / Atlassian Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore JIRA/Atlassian integration from RepoWatch into RepoSentinel per `docs/superpowers/specs/2026-07-07-jira-atlassian-integration-design.md`: a single Atlassian connection, PR-to-ticket linking (auto-detect + manual override), DB-cached AI-generated acceptance-criteria checklists, review-flow checklist injection with two new finding severities, a JIRA browser page, and RBAC gating.

**Architecture:** Trim and adapt RepoWatch's multi-connection/board/sprint Atlassian model down to a single site-wide connection with no sprint concept, per the design doc. Replace RepoWatch's file-based checklist cache with a `JiraChecklist` DB table so the checklist browser doesn't depend on any review's on-disk checkout. Keep the review-pipeline touchpoint to one best-effort, non-blocking step in `run-ai-review-job.ts`, mirroring the existing `writeOpenCommentsJson` step.

**Tech Stack:** TypeScript, Prisma/PostgreSQL, Fastify, Vitest, BullMQ, Angular standalone components, Angular Material, native `fetch` (Atlassian REST v3/v2), Node `child_process.spawn` (one-shot Claude CLI call).

**Reference implementation:** `C:\KMS\Practice\repo-watch-main\repo-watch-main\apps\api\src\services\{atlassian-api-client-service,atlassian-connection-service,jira-ticket-service,jira-checklist-service}.ts` and `.../routes/{atlassian-connection-routes,jira-routes}.ts`, `.../utils/hostname-validation.ts`. These are the source to adapt, not copy verbatim — the original's list-based connection (with `projectKey`/`boardId`), sprint browsing, file-based checklist cache, and `WatchedAtlassianUser`/activity-sync pieces are all out of scope per the design doc's Scope section.

---

## File Structure

Schema and types:

- Modify `packages/db/prisma/schema.prisma`: add `AtlassianConnection`, `JiraChecklist`, `PullRequest.jiraTicketKeyOverride`.
- Create migration `packages/db/prisma/migrations/20260708120000_jira_atlassian_integration/migration.sql`.
- Modify `packages/types/src/enums.ts`: add `Resource.Atlassian`.
- Modify `packages/types/src/review-types.ts`: extend `FindingSeverity` with `mismatch_requirement`/`checklist_required`.
- Modify `packages/types/src/pull-request-types.ts`: add `jiraTicketKeyOverride` to `PullRequestDto`.
- Create `packages/types/src/atlassian-types.ts`: `AtlassianConnectionDto`, `CreateAtlassianConnectionInput`, `AtlassianConnectionTestResult`, `JiraTicketDto`, `JiraChecklistDto`.
- Modify `packages/types/src/index.ts`: export the new module.
- Modify `apps/web/src/app/core/models/enums.ts`: mirror `Resource.Atlassian`.
- Modify `apps/web/src/app/core/models/dto.ts`: mirror all new DTOs + `FindingSeverity`/`PullRequestDto` changes.

Backend schemas/routes:

- Create `apps/api/src/schemas/atlassian-schemas.ts`: connection create/replace schema, ticket-key test schema.
- Create `apps/api/src/schemas/jira-schemas.ts`: ticket search query, ticket key param, checklist body schemas, PR ticket-link body schema.
- Create `apps/api/src/routes/atlassian-connection-routes.ts`: singleton connection CRUD + test + test-ticket.
- Create `apps/api/src/routes/jira-routes.ts`: ticket search/detail + checklist CRUD.
- Modify `apps/api/src/routes/pull-requests-routes.ts`: add `PATCH /api/pull-requests/:id/jira-ticket`.
- Modify `apps/api/src/index.ts`: register both new route modules.

Backend services:

- Modify `apps/api/src/utils/hostname-validation.ts`: add `validateAtlassianHostname`.
- Create `apps/api/src/services/atlassian-api-client-service.ts`: `buildAuthHeader`, `atlassianFetch` (429 retry), `fetchCurrentUser`, `searchIssuesByJql`.
- Create `apps/api/src/services/atlassian-connection-service.ts`: singleton get/replace/delete/test/getDecrypted.
- Create `apps/api/src/services/jira-ticket-service.ts`: `extractTicketKeys`, `resolveTicketKeysForPr`, `fetchJiraTicket`, `searchTickets`.
- Create `apps/api/src/services/jira-checklist-service.ts`: `generateChecklist`, `getChecklist`, `updateChecklist`, `deleteChecklist`, `getCachedChecklistsForKeys`.
- Modify `apps/api/src/services/command-template-service.ts`: severity definitions + JIRA checklist prompt section.
- Modify `apps/api/src/services/code-review-json-parser.ts`: `VALID_SEVERITIES` + `stats` gain the two new severities.
- Modify `apps/api/src/services/settings-seed-service.ts`: seed `ai.review.jiraEnabled`, `ai.review.jiraTicketPattern`.
- Modify `apps/api/src/schemas/settings-schemas.ts`: validate `ai.review.jiraTicketPattern` compiles as a regex.
- Modify `apps/api/src/lib/auth-seed.ts`: Reviewer gains `Atlassian:*` + `PullRequests:Update`; Viewer gains `Atlassian:Read`.
- Modify `apps/api/src/queues/run-ai-review-job.ts`: new best-effort step 3c (checklist injection).

Frontend:

- Modify `apps/web/src/app/features/connections/connections.service.ts` pattern: create `apps/web/src/app/features/connections/atlassian-connections.service.ts`.
- Create `apps/web/src/app/features/connections/atlassian-connection-form-dialog/` (`.ts`/`.html`/`.scss`).
- Modify `apps/web/src/app/features/connections/connections-page/connections-page.ts` (+`.html`): add Atlassian card.
- Create `apps/web/src/app/features/jira/jira.service.ts`.
- Create `apps/web/src/app/features/jira/jira-page/` (`.ts`/`.html`/`.scss`).
- Create `apps/web/src/app/features/jira/jira-ticket-detail/` (`.ts`/`.html`/`.scss`).
- Modify `apps/web/src/app/app.routes.ts`: add `/jira` route.
- Modify `apps/web/src/app/layout/sidebar-nav/sidebar-nav.ts`: add nav entry gated on `Atlassian:Read`.
- Modify `apps/web/src/app/features/pull-request-detail/reviews.service.ts` (or a small addition): `setJiraTicket`.
- Modify `apps/web/src/app/features/pull-request-detail/pull-request-detail-page/pull-request-detail-page.ts` (+`.html`): linked-ticket panel.
- Modify `apps/web/src/app/features/settings/settings-page/settings-page.ts` (+`.html`): JIRA toggle + regex field.

Tests:

- Create `apps/api/src/__tests__/hostname-validation.test.ts` (Atlassian hostname cases).
- Create `apps/api/src/__tests__/atlassian-connection-service.test.ts`.
- Create `apps/api/src/__tests__/jira-ticket-service.test.ts`.
- Create `apps/api/src/__tests__/jira-checklist-service.test.ts`.
- Create `apps/api/src/__tests__/code-review-json-parser.test.ts` (extend if it already covers severities; add cases otherwise).

## Implementation Tasks

### Task 1: Schema, Migration, and Shared Types

**Files:**

- Modify `packages/db/prisma/schema.prisma`
- Create `packages/db/prisma/migrations/20260708120000_jira_atlassian_integration/migration.sql`
- Modify `packages/types/src/enums.ts`
- Modify `packages/types/src/review-types.ts`
- Modify `packages/types/src/pull-request-types.ts`
- Create `packages/types/src/atlassian-types.ts`
- Modify `packages/types/src/index.ts`
- Modify `apps/web/src/app/core/models/enums.ts`
- Modify `apps/web/src/app/core/models/dto.ts`

- [ ] **Step 1: Add Prisma models**

Add to `schema.prisma`, and add `jiraTicketKeyOverride` to the existing `PullRequest` model:

```prisma
model AtlassianConnection {
  id        String   @id @default(cuid())
  hostname  String   @unique
  email     String
  apiToken  String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model JiraChecklist {
  ticketKey   String   @id
  content     String   @db.Text
  generatedAt DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

In `PullRequest`, add (nullable, additive, no backfill):

```prisma
  jiraTicketKeyOverride String?
```

- [ ] **Step 2: Add SQL migration**

```sql
CREATE TABLE "AtlassianConnection" (
  "id" TEXT NOT NULL,
  "hostname" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "apiToken" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AtlassianConnection_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AtlassianConnection_hostname_key" ON "AtlassianConnection"("hostname");

CREATE TABLE "JiraChecklist" (
  "ticketKey" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JiraChecklist_pkey" PRIMARY KEY ("ticketKey")
);

ALTER TABLE "PullRequest" ADD COLUMN "jiraTicketKeyOverride" TEXT;
```

- [ ] **Step 3: Add `Resource.Atlassian`**

In both `packages/types/src/enums.ts` and `apps/web/src/app/core/models/enums.ts`, add to the `Resource` enum (alphabetical, matches existing ordering):

```ts
Atlassian = "atlassian",
```

(becomes the 14th value, ahead of `Connections`).

- [ ] **Step 4: Extend `FindingSeverity`**

In `packages/types/src/review-types.ts`:

```ts
export type FindingSeverity =
  | "critical" | "high" | "medium" | "low" | "info"
  | "mismatch_requirement" | "checklist_required";
```

Mirror in `apps/web/src/app/core/models/dto.ts`'s `FindingSeverity` type.

- [ ] **Step 5: Add `jiraTicketKeyOverride` to `PullRequestDto`**

In `packages/types/src/pull-request-types.ts`, add `jiraTicketKeyOverride: string | null;` to `PullRequestDto`. Mirror in `apps/web/.../dto.ts`'s `PullRequestDto`.

- [ ] **Step 6: Add Atlassian/JIRA DTOs**

Create `packages/types/src/atlassian-types.ts`:

```ts
/** DTOs and input types for the singleton Atlassian connection and JIRA ticket/checklist browsing. */

export interface AtlassianConnectionDto {
  id: string;
  hostname: string;
  email: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAtlassianConnectionInput {
  hostname: string;
  email: string;
  /** Raw API token — encrypted before storage, never returned in responses */
  apiToken: string;
}

export interface AtlassianConnectionTestResult {
  success: boolean;
  message: string;
  displayName?: string;
}

export interface JiraTicketDto {
  key: string;
  summary: string;
  description: string;
  status: string;
  url: string;
  /** ISO timestamp of the ticket's last JIRA-side update — used for checklist staleness comparison */
  updated: string;
}

export interface JiraChecklistDto {
  ticketKey: string;
  content: string;
  generatedAt: string;
  updatedAt: string;
  /** True when the linked ticket's `updated` timestamp is newer than `generatedAt` */
  stale: boolean;
}
```

Add `export * from "./atlassian-types.js";` to `packages/types/src/index.ts`.

Hand-port the same four interfaces into `apps/web/src/app/core/models/dto.ts` (own section, e.g. after the Connections section), matching the existing hand-port convention for `GheConnectionDto`.

- [ ] **Step 7: Generate Prisma client and build types package**

Run:

```bash
npm run db:generate
npm run build --workspace=@repo-sentinel/types
```

Expected: both PASS.

- [ ] **Step 8: Checkpoint**

```bash
git add packages/db/prisma packages/types/src apps/web/src/app/core/models
git commit -m "feat: add JIRA/Atlassian schema, enums, and shared DTOs"
```

### Task 2: Hostname Validation and Atlassian API Client

**Files:**

- Modify `apps/api/src/utils/hostname-validation.ts`
- Create `apps/api/src/services/atlassian-api-client-service.ts`
- Test `apps/api/src/__tests__/hostname-validation.test.ts`

- [ ] **Step 1: Write failing hostname validation tests**

```ts
import { describe, expect, it } from "vitest";
import { validateAtlassianHostname, validateHostname } from "../utils/hostname-validation.js";

describe("validateAtlassianHostname", () => {
  it("rejects non-atlassian.net hostnames", async () => {
    await expect(validateAtlassianHostname("example.com")).rejects.toThrow(/atlassian Cloud/);
  });

  it("rejects private/loopback IP literals even with the right suffix spoofed", () => {
    expect(() => validateHostname("localhost")).toThrow();
  });

  it("accepts a plausible atlassian.net hostname (network call — resolves or fails closed)", async () => {
    // Use a domain that does not resolve to assert fail-closed behavior deterministically.
    await expect(validateAtlassianHostname("this-does-not-exist-repo-sentinel-test.atlassian.net"))
      .rejects.toThrow(/could not be resolved/);
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test --workspace=@repo-sentinel/api -- hostname-validation.test.ts`

Expected before implementation: FAIL because `validateAtlassianHostname` does not exist.

- [ ] **Step 3: Add `validateAtlassianHostname`**

Port from `repo-watch-main/apps/api/src/utils/hostname-validation.ts`, adapted to the current file's structure (it already has `BLOCKED_HOSTNAMES`/`isPrivateIpv4`/`validateHostname`; only the Atlassian-specific pieces are new):

```ts
import dns from "node:dns/promises";

function assertPublicIp(ip: string, hostname: string): void {
  const lower = ip.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(lower)) {
    throw new Error(`Hostname "${hostname}" resolves to a blocked address`);
  }
  const ipv4Parts = lower.split(".");
  if (ipv4Parts.length === 4 && ipv4Parts.every((p) => /^\d+$/.test(p))) {
    const [a, b] = ipv4Parts.map(Number) as [number, number, number, number];
    if (isPrivateIpv4(a, b)) {
      throw new Error(`Hostname "${hostname}" resolves to a private IP address`);
    }
  }
}

/**
 * Validate an Atlassian hostname: must end in .atlassian.net, pass the static
 * SSRF check, and resolve to a public IP (fail-closed on DNS rebinding / unresolvable hosts).
 * This hardening is scoped to the Atlassian connection path only.
 */
export async function validateAtlassianHostname(hostname: string): Promise<void> {
  const lower = hostname.toLowerCase();
  if (!lower.endsWith(".atlassian.net")) {
    throw new Error(`Hostname "${hostname}" is not a valid Atlassian Cloud hostname (must end with .atlassian.net)`);
  }
  validateHostname(lower);

  let addresses: string[] = [];
  try {
    const v4 = await dns.resolve4(lower).catch(() => [] as string[]);
    const v6 = await dns.resolve6(lower).catch(() => [] as string[]);
    addresses = [...v4, ...v6];
  } catch {
    throw new Error(`Hostname "${hostname}" could not be resolved. Only resolvable public hostnames are allowed.`);
  }
  if (addresses.length === 0) {
    throw new Error(`Hostname "${hostname}" could not be resolved. Only resolvable public hostnames are allowed.`);
  }
  for (const ip of addresses) assertPublicIp(ip, hostname);
}
```

- [ ] **Step 4: Create the trimmed Atlassian API client**

Create `atlassian-api-client-service.ts`, porting only `buildAuthHeader`, `atlassianFetch` (429 retry/backoff, `RateLimitExhaustedError`), `fetchCurrentUser`, and `searchIssuesByJql` from the reference file. Drop `searchUsers`, `fetchBoardMembers`, `fetchIssueWorklogs`, `fetchIssueChangelog`, `fetchConfluenceUserPages` — all deferred-scope only per the design doc.

Keep the exported surface:

```ts
export class RateLimitExhaustedError extends Error { /* ... */ }
export function buildAuthHeader(email: string, apiToken: string): string;
export async function atlassianFetch(hostname: string, path: string, email: string, apiToken: string, options?: RequestInit): Promise<Response>;
export async function fetchCurrentUser(hostname: string, email: string, apiToken: string): Promise<{ accountId: string; displayName: string; emailAddress: string }>;
export interface JiraIssue { key: string; id: string; fields: Record<string, unknown>; }
export async function searchIssuesByJql(hostname: string, email: string, apiToken: string, jql: string, fields: string[], maxResults?: number): Promise<{ issues: JiraIssue[]; total: number; startAt: number; maxResults: number }>;
```

- [ ] **Step 5: Run tests and build**

```bash
npm test --workspace=@repo-sentinel/api -- hostname-validation.test.ts
npm run build --workspace=@repo-sentinel/api
```

Expected: PASS.

- [ ] **Step 6: Checkpoint**

```bash
git add apps/api/src/utils/hostname-validation.ts apps/api/src/services/atlassian-api-client-service.ts apps/api/src/__tests__/hostname-validation.test.ts
git commit -m "feat: add Atlassian hostname validation and API client"
```

### Task 3: Atlassian Connection Service, Routes, and Permission Seeding

**Files:**

- Create `apps/api/src/schemas/atlassian-schemas.ts`
- Create `apps/api/src/services/atlassian-connection-service.ts`
- Create `apps/api/src/routes/atlassian-connection-routes.ts`
- Modify `apps/api/src/index.ts`
- Modify `apps/api/src/lib/auth-seed.ts`
- Test `apps/api/src/__tests__/atlassian-connection-service.test.ts`

- [ ] **Step 1: Add failing connection service tests**

Mock Prisma and `fetchCurrentUser`/`validateAtlassianHostname`. Cover singleton replace semantics, hostname rejection, and credential-test failure.

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../utils/hostname-validation.js", () => ({
  validateAtlassianHostname: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../services/atlassian-api-client-service.js", () => ({
  fetchCurrentUser: vi.fn().mockResolvedValue({ accountId: "acc_1", displayName: "Bot", emailAddress: "bot@co.com" }),
}));
vi.mock("../services/encryption-service.js", () => ({
  encrypt: vi.fn((s: string) => `enc:${s}`),
  decrypt: vi.fn((s: string) => s.replace(/^enc:/, "")),
}));

describe("atlassian-connection-service", () => {
  let prisma: any;

  beforeEach(() => {
    prisma = {
      atlassianConnection: {
        findFirst: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockImplementation(({ create }: any) => Promise.resolve({
          id: "conn_1", ...create, createdAt: new Date(), updatedAt: new Date(),
        })),
        findUnique: vi.fn(),
        delete: vi.fn(),
      },
    };
  });

  it("replaces the singleton connection (upsert, not create/list)", async () => {
    const { replaceConnection } = await import("../services/atlassian-connection-service.js");
    const dto = await replaceConnection(prisma, { hostname: "acme.atlassian.net", email: "a@acme.com", apiToken: "tok" });
    expect(dto.hostname).toBe("acme.atlassian.net");
    expect(prisma.atlassianConnection.upsert).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test --workspace=@repo-sentinel/api -- atlassian-connection-service.test.ts`

Expected before implementation: FAIL because the service does not exist.

- [ ] **Step 3: Implement `atlassian-connection-service.ts`**

Since there is exactly one row, model "replace" as an upsert against a well-known lookup (find the existing row's id first, or use a fixed singleton id). Use `findFirst` to locate the current row (there's no natural unique key to upsert against besides `hostname`, which itself may change on replace), then delete-and-recreate inside a transaction if a row exists with a different hostname, else plain create.

```ts
import type { PrismaClient } from "@repo-sentinel/db";
import type { AtlassianConnectionDto, AtlassianConnectionTestResult, CreateAtlassianConnectionInput } from "@repo-sentinel/types";
import { encrypt, decrypt } from "./encryption-service.js";
import { validateAtlassianHostname } from "../utils/hostname-validation.js";
import { fetchCurrentUser } from "./atlassian-api-client-service.js";

function toDto(row: { id: string; hostname: string; email: string; createdAt: Date; updatedAt: Date }): AtlassianConnectionDto {
  return { id: row.id, hostname: row.hostname, email: row.email, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

export async function getConnection(prisma: PrismaClient): Promise<AtlassianConnectionDto | null> {
  const row = await prisma.atlassianConnection.findFirst();
  return row ? toDto(row) : null;
}

/** Validate hostname, live-test credentials, encrypt, then replace the singleton row. */
export async function replaceConnection(
  prisma: PrismaClient,
  input: CreateAtlassianConnectionInput
): Promise<AtlassianConnectionDto> {
  await validateAtlassianHostname(input.hostname);
  const user = await fetchCurrentUser(input.hostname, input.email, input.apiToken);
  if (!user.accountId) throw new Error("Atlassian credentials are invalid — could not retrieve account info");

  const encryptedToken = encrypt(input.apiToken);
  const existing = await prisma.atlassianConnection.findFirst();
  const row = existing
    ? await prisma.atlassianConnection.update({
        where: { id: existing.id },
        data: { hostname: input.hostname, email: input.email, apiToken: encryptedToken },
      })
    : await prisma.atlassianConnection.create({
        data: { hostname: input.hostname, email: input.email, apiToken: encryptedToken },
      });
  return toDto(row);
}

export async function deleteConnection(prisma: PrismaClient): Promise<void> {
  const existing = await prisma.atlassianConnection.findFirst();
  if (existing) await prisma.atlassianConnection.delete({ where: { id: existing.id } });
}

export async function testConnection(prisma: PrismaClient): Promise<AtlassianConnectionTestResult> {
  const row = await prisma.atlassianConnection.findFirst();
  if (!row) return { success: false, message: "No Atlassian connection configured" };
  try {
    await validateAtlassianHostname(row.hostname);
    const apiToken = decrypt(row.apiToken);
    const user = await fetchCurrentUser(row.hostname, row.email, apiToken);
    return { success: true, message: "Connection is valid", displayName: user.displayName };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : "Unknown error" };
  }
}

/** Internal only — decrypted token, used by jira-ticket-service / jira-checklist-service / run-ai-review-job. */
export async function getDecryptedConnection(
  prisma: PrismaClient
): Promise<{ id: string; hostname: string; email: string; apiToken: string } | null> {
  const row = await prisma.atlassianConnection.findFirst();
  if (!row) return null;
  return { id: row.id, hostname: row.hostname, email: row.email, apiToken: decrypt(row.apiToken) };
}
```

- [ ] **Step 4: Add `atlassian-schemas.ts`**

```ts
import { z } from "zod";

const ATLASSIAN_HOSTNAME_REGEX = /^[a-zA-Z0-9-]+\.atlassian\.net$/;

export const replaceAtlassianConnectionSchema = z.object({
  hostname: z.string().min(1).regex(ATLASSIAN_HOSTNAME_REGEX, "Hostname must be a *.atlassian.net domain"),
  email: z.string().email("Must be a valid email address"),
  apiToken: z.string().min(1, "API token is required"),
});
export type ReplaceAtlassianConnectionInput = z.infer<typeof replaceAtlassianConnectionSchema>;

export const testTicketBodySchema = z.object({
  ticketKey: z.string().min(1).max(64).regex(/^[A-Z][A-Z0-9]+-\d+$/i, "Must look like PROJECT-123"),
});
export type TestTicketBody = z.infer<typeof testTicketBodySchema>;
```

- [ ] **Step 5: Add `atlassian-connection-routes.ts`**

Mirror `connection-routes.ts`'s structure, but singleton (no `:id` params):

```ts
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { ZodError } from "zod";
import { replaceAtlassianConnectionSchema, testTicketBodySchema } from "../schemas/atlassian-schemas.js";
import {
  getConnection, replaceConnection, deleteConnection, testConnection, getDecryptedConnection,
} from "../services/atlassian-connection-service.js";
import { fetchJiraTicket } from "../services/jira-ticket-service.js";
import { Resource, Action } from "@repo-sentinel/types";
import { requireAuth } from "../middleware/auth-middleware.js";
import { requirePermission } from "../middleware/permission-middleware.js";

function handleZodError(err: ZodError, reply: FastifyReply): void {
  reply.status(400).send({ success: false, error: "Validation failed", details: err.flatten().fieldErrors });
}

export async function registerAtlassianConnectionRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/atlassian/connection", { preHandler: [requireAuth, requirePermission(Resource.Atlassian, Action.Read)] },
    async (_request, reply: FastifyReply) => {
      reply.send({ success: true, data: await getConnection(app.prisma) });
    });

  app.put("/api/atlassian/connection", { preHandler: [requireAuth, requirePermission(Resource.Atlassian, Action.Create)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = replaceAtlassianConnectionSchema.safeParse(request.body);
      if (!parsed.success) { handleZodError(parsed.error, reply); return; }
      try {
        const dto = await replaceConnection(app.prisma, parsed.data);
        reply.send({ success: true, data: dto });
      } catch (err) {
        reply.status(422).send({ success: false, error: err instanceof Error ? err.message : "Failed to save connection" });
      }
    });

  app.delete("/api/atlassian/connection", { preHandler: [requireAuth, requirePermission(Resource.Atlassian, Action.Delete)] },
    async (_request, reply: FastifyReply) => {
      await deleteConnection(app.prisma);
      reply.status(204).send();
    });

  app.post("/api/atlassian/connection/test", { preHandler: [requireAuth, requirePermission(Resource.Atlassian, Action.Read)] },
    async (_request, reply: FastifyReply) => {
      const result = await testConnection(app.prisma);
      reply.status(result.success ? 200 : 422).send({ success: result.success, data: result });
    });

  app.post("/api/atlassian/connection/test-ticket", { preHandler: [requireAuth, requirePermission(Resource.Atlassian, Action.Read)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = testTicketBodySchema.safeParse(request.body);
      if (!parsed.success) { handleZodError(parsed.error, reply); return; }
      const conn = await getDecryptedConnection(app.prisma);
      if (!conn) { reply.status(400).send({ success: false, error: "No Atlassian connection configured" }); return; }
      try {
        const ticket = await fetchJiraTicket(conn.hostname, conn.email, conn.apiToken, parsed.data.ticketKey.toUpperCase());
        reply.send({ success: true, data: ticket });
      } catch (err) {
        reply.status(422).send({ success: false, error: err instanceof Error ? err.message : "Ticket fetch failed" });
      }
    });
}
```

- [ ] **Step 6: Register route and seed permissions**

In `apps/api/src/index.ts`, import and register `registerAtlassianConnectionRoutes` alongside the other connection routes (before `registerReposRoutes`, matching the existing `GheConnection` → `WatchedRepo` ordering).

In `auth-seed.ts`, extend the `Reviewer` permission list with:

```ts
`${Resource.Atlassian}:${Action.Create}`, `${Resource.Atlassian}:${Action.Read}`,
`${Resource.Atlassian}:${Action.Update}`, `${Resource.Atlassian}:${Action.Delete}`,
`${Resource.PullRequests}:${Action.Update}`,
```

and the `Viewer` list with:

```ts
`${Resource.Atlassian}:${Action.Read}`,
```

`Admin`'s `"*"` picks up `Atlassian` automatically via the `Resource × Action` cross product — no change needed there.

- [ ] **Step 7: Run tests and build**

```bash
npm test --workspace=@repo-sentinel/api -- atlassian-connection-service.test.ts
npm run build --workspace=@repo-sentinel/api
```

Expected: PASS.

- [ ] **Step 8: Checkpoint**

```bash
git add apps/api/src/schemas/atlassian-schemas.ts apps/api/src/services/atlassian-connection-service.ts apps/api/src/routes/atlassian-connection-routes.ts apps/api/src/index.ts apps/api/src/lib/auth-seed.ts apps/api/src/__tests__/atlassian-connection-service.test.ts
git commit -m "feat: add singleton Atlassian connection service, routes, and RBAC"
```

### Task 4: JIRA Ticket Extraction, Fetch, and Search

**Files:**

- Create `apps/api/src/services/jira-ticket-service.ts`
- Test `apps/api/src/__tests__/jira-ticket-service.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it, vi } from "vitest";
import { extractTicketKeys, resolveTicketKeysForPr } from "../services/jira-ticket-service.js";

describe("jira-ticket-service", () => {
  const pattern = "[A-Z][A-Z0-9]+-\\d+";

  it("extracts ticket keys across title, body, and branch", () => {
    expect(extractTicketKeys("Fix PROJ-123 bug", "See also OPS-9", "feature/PROJ-123-fix", pattern))
      .toEqual(expect.arrayContaining(["PROJ-123", "OPS-9"]));
  });

  it("dedupes repeated keys", () => {
    expect(extractTicketKeys("PROJ-123 PROJ-123", null, "PROJ-123", pattern)).toEqual(["PROJ-123"]);
  });

  it("prefers the manual override over auto-detection", async () => {
    const prisma: any = { appSetting: { findUnique: vi.fn().mockResolvedValue(null) } };
    const keys = await resolveTicketKeysForPr(prisma, {
      jiraTicketKeyOverride: "OVR-1", title: "PROJ-123", body: null, headRef: "main",
    });
    expect(keys).toEqual(["OVR-1"]);
  });

  it("falls back to auto-detect and reads the pattern from settings", async () => {
    const prisma: any = { appSetting: { findUnique: vi.fn().mockResolvedValue({ value: pattern }) } };
    const keys = await resolveTicketKeysForPr(prisma, {
      jiraTicketKeyOverride: null, title: "PROJ-123 fix", body: null, headRef: "main",
    });
    expect(keys).toEqual(["PROJ-123"]);
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test --workspace=@repo-sentinel/api -- jira-ticket-service.test.ts`

Expected before implementation: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the service**

Port `extractTicketKeys` from the reference (extend to also scan `headRef`), the ADF-to-plaintext + HTML-strip helpers, and `fetchJiraTicket` (Cloud v3, Server v2 fallback) from `jira-ticket-service.ts` / `jira-checklist-service.ts`'s `fetchTicketContent`. Add `resolveTicketKeysForPr` and `searchTickets` (new — needed for the design's scope, not in the reference file):

```ts
import type { PrismaClient } from "@repo-sentinel/db";
import type { JiraTicketDto } from "@repo-sentinel/types";
import { searchIssuesByJql, type JiraIssue } from "./atlassian-api-client-service.js";

const DEFAULT_PATTERN = "[A-Z][A-Z0-9]+-\\d+";

export function extractTicketKeys(title: string, body: string | null, headRef: string, pattern: string): string[] {
  try {
    const regex = new RegExp(pattern, "g");
    const combined = `${title} ${body ?? ""} ${headRef}`;
    const matches = combined.match(regex);
    return matches ? [...new Set(matches.map((m) => m.toUpperCase()))] : [];
  } catch {
    return [];
  }
}

export async function resolveTicketKeysForPr(
  prisma: PrismaClient,
  pr: { jiraTicketKeyOverride: string | null; title: string; body: string | null; headRef: string }
): Promise<string[]> {
  if (pr.jiraTicketKeyOverride) return [pr.jiraTicketKeyOverride];
  const setting = await prisma.appSetting.findUnique({ where: { key: "ai.review.jiraTicketPattern" } });
  return extractTicketKeys(pr.title, pr.body, pr.headRef, setting?.value ?? DEFAULT_PATTERN);
}

/** Fetch one ticket (Cloud v3, Server v2 fallback), converting ADF/HTML description to plain text. */
export async function fetchJiraTicket(
  hostname: string, email: string, apiToken: string, ticketKey: string
): Promise<JiraTicketDto> {
  const auth = Buffer.from(`${email}:${apiToken}`).toString("base64");
  const baseUrl = `https://${hostname}`;
  let res = await fetch(`${baseUrl}/rest/api/3/issue/${ticketKey}?expand=renderedFields`, {
    headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
  });
  if (!res.ok) {
    res = await fetch(`${baseUrl}/rest/api/2/issue/${ticketKey}?expand=renderedFields`, {
      headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
    });
  }
  if (!res.ok) throw new Error(`JIRA returned ${res.status}: ticket not found or access denied`);

  const issue = await res.json() as Record<string, unknown>;
  const fields = issue.fields as Record<string, unknown> ?? {};
  const rendered = issue.renderedFields as Record<string, unknown> ?? {};

  let description = "";
  if (typeof rendered.description === "string") description = stripHtml(rendered.description);
  else if (fields.description && typeof fields.description === "object") description = adfToPlainText(fields.description as Record<string, unknown>);
  else if (typeof fields.description === "string") description = fields.description;

  return {
    key: issue.key as string,
    summary: (fields.summary as string) ?? "",
    description,
    status: ((fields.status as Record<string, unknown>)?.name as string) ?? "",
    url: `${baseUrl}/browse/${issue.key}`,
    updated: (fields.updated as string) ?? new Date().toISOString(),
  };
}

/** Thin wrapper over searchIssuesByJql for the JIRA browser page. */
export async function searchTickets(
  hostname: string, email: string, apiToken: string,
  filter: { jql?: string; projectKey?: string; key?: string }
): Promise<JiraTicketDto[]> {
  const jql = filter.jql?.trim()
    || (filter.key ? `key = ${filter.key.toUpperCase()}` : undefined)
    || (filter.projectKey ? `project = ${filter.projectKey} ORDER BY updated DESC` : undefined)
    || "order by updated DESC";
  const fields = ["summary", "status", "description", "updated"];
  const { issues } = await searchIssuesByJql(hostname, email, apiToken, jql, fields, 50);
  return issues.map((issue: JiraIssue) => toTicketDto(hostname, issue));
}

function toTicketDto(hostname: string, issue: JiraIssue): JiraTicketDto {
  const fields = issue.fields;
  const rawDescription = fields.description;
  const description = typeof rawDescription === "string"
    ? rawDescription
    : rawDescription && typeof rawDescription === "object"
      ? adfToPlainText(rawDescription as Record<string, unknown>)
      : "";
  return {
    key: issue.key,
    summary: (fields.summary as string) ?? "",
    description,
    status: ((fields.status as Record<string, unknown>)?.name as string) ?? "",
    url: `https://${hostname}/browse/${issue.key}`,
    updated: (fields.updated as string) ?? new Date().toISOString(),
  };
}

function stripHtml(html: string): string { /* port verbatim from reference */ return html; }
function adfToPlainText(doc: Record<string, unknown>): string { /* port verbatim from reference */ return ""; }
```

(Port the real bodies of `stripHtml`/`adfToPlainText` from the reference file — the stubs above are placeholders for this plan's readability only.)

- [ ] **Step 4: Run tests and build**

```bash
npm test --workspace=@repo-sentinel/api -- jira-ticket-service.test.ts
npm run build --workspace=@repo-sentinel/api
```

Expected: PASS.

- [ ] **Step 5: Checkpoint**

```bash
git add apps/api/src/services/jira-ticket-service.ts apps/api/src/__tests__/jira-ticket-service.test.ts
git commit -m "feat: add JIRA ticket extraction, fetch, and search"
```

### Task 5: JIRA Checklist Service and Routes

**Files:**

- Create `apps/api/src/schemas/jira-schemas.ts`
- Create `apps/api/src/services/jira-checklist-service.ts`
- Create `apps/api/src/routes/jira-routes.ts`
- Modify `apps/api/src/index.ts`
- Test `apps/api/src/__tests__/jira-checklist-service.test.ts`

- [ ] **Step 1: Write failing tests**

Mock the ticket fetch and the Claude CLI spawn helper; assert DB upsert and staleness.

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("../services/atlassian-connection-service.js", () => ({
  getDecryptedConnection: vi.fn().mockResolvedValue({ hostname: "acme.atlassian.net", email: "a@acme.com", apiToken: "tok" }),
}));
vi.mock("../services/jira-ticket-service.js", () => ({
  fetchJiraTicket: vi.fn().mockResolvedValue({
    key: "PROJ-1", summary: "Do the thing", description: "Must return 200", status: "In Progress",
    url: "https://acme.atlassian.net/browse/PROJ-1", updated: "2026-07-08T00:00:00Z",
  }),
}));

describe("jira-checklist-service", () => {
  it("persists a generated checklist row", async () => {
    const prisma: any = {
      jiraChecklist: {
        upsert: vi.fn().mockResolvedValue({
          ticketKey: "PROJ-1", content: "- [ ] Returns 200", generatedAt: new Date(), updatedAt: new Date(),
        }),
      },
    };
    const svc = await import("../services/jira-checklist-service.js");
    vi.spyOn(svc as any, "runClaudeCliOnce").mockResolvedValue("- [ ] Returns 200");
    const result = await svc.generateChecklist(prisma, "proj-1");
    expect(result.ticketKey).toBe("PROJ-1");
    expect(prisma.jiraChecklist.upsert).toHaveBeenCalled();
  });

  it("flags staleness when the ticket updated after generation", async () => {
    const prisma: any = {
      jiraChecklist: {
        findUnique: vi.fn().mockResolvedValue({
          ticketKey: "PROJ-1", content: "x", generatedAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"),
        }),
      },
    };
    const { getChecklist } = await import("../services/jira-checklist-service.js");
    const result = await getChecklist(prisma, "PROJ-1");
    expect(result?.stale).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test --workspace=@repo-sentinel/api -- jira-checklist-service.test.ts`

Expected before implementation: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `jira-checklist-service.ts`**

Port the prompt-building logic and `runClaudeCli` spawn helper from the reference `jira-checklist-service.ts` (rename to `runClaudeCliOnce` to make clear it's the one-shot, non-streaming variant — distinct from `claude-cli-service.ts`'s streaming invocation used by the main review job). Replace the file-based cache with the `JiraChecklist` table:

```ts
import type { PrismaClient } from "@repo-sentinel/db";
import type { JiraChecklistDto } from "@repo-sentinel/types";
import { spawn } from "node:child_process";
import { getDecryptedConnection } from "./atlassian-connection-service.js";
import { fetchJiraTicket } from "./jira-ticket-service.js";
import { getSetting } from "./settings-service.js";

function toDto(row: { ticketKey: string; content: string; generatedAt: Date; updatedAt: Date }, stale: boolean): JiraChecklistDto {
  return {
    ticketKey: row.ticketKey, content: row.content,
    generatedAt: row.generatedAt.toISOString(), updatedAt: row.updatedAt.toISOString(), stale,
  };
}

function buildPrompt(ticket: { key: string; summary: string; description: string }): string {
  return `You are a QA analyst. Generate a requirement checklist from this JIRA ticket for code review purposes.

## JIRA Ticket: ${ticket.key}

### Summary
${ticket.summary}

### Description
${ticket.description}

## Instructions
1. Extract ALL acceptance criteria, requirements, and expected behaviors from the ticket
2. Each checklist item should be a specific, verifiable requirement
3. Include field names, status codes, error formats mentioned in the ticket
4. Output ONLY the checklist content (no frontmatter), using markdown checkbox format: - [ ] Requirement description
Focus on requirements that can be verified against code in a PR.`;
}

/** One-shot, non-streaming Claude CLI invocation — no terminal/room to stream into for this call. */
async function runClaudeCliOnce(cliPath: string, model: string, prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cliPath, ["-p", prompt, "--model", model, "--no-session-persistence", "--dangerously-skip-permissions"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, CLAUDECODE: undefined },
    });
    child.stdin!.end();
    let stdout = "", stderr = "";
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error("Claude CLI timeout (120s)")); }, 120_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`Claude CLI failed (code ${code}): ${stderr.substring(0, 200)}`));
    });
    child.on("error", (err) => { clearTimeout(timer); reject(err); });
  });
}

export async function generateChecklist(
  prisma: PrismaClient, ticketKey: string,
  log?: { info: (obj: object, msg: string) => void }
): Promise<JiraChecklistDto> {
  const key = ticketKey.toUpperCase();
  const conn = await getDecryptedConnection(prisma);
  if (!conn) throw new Error("JIRA connection not configured");

  const ticket = await fetchJiraTicket(conn.hostname, conn.email, conn.apiToken, key);
  const cliPath = await getSetting("ai.review.agent", "") || "claude";
  const model = await getSetting("ai.review.model", "sonnet");

  log?.info({ ticketKey: key }, "[jira-checklist] generating");
  const content = await runClaudeCliOnce(cliPath, model, buildPrompt(ticket));

  const row = await prisma.jiraChecklist.upsert({
    where: { ticketKey: key },
    update: { content },
    create: { ticketKey: key, content },
  });
  return toDto(row, false);
}

export async function getChecklist(prisma: PrismaClient, ticketKey: string): Promise<JiraChecklistDto | null> {
  const key = ticketKey.toUpperCase();
  const row = await prisma.jiraChecklist.findUnique({ where: { ticketKey: key } });
  if (!row) return null;

  let stale = false;
  try {
    const conn = await getDecryptedConnection(prisma);
    if (conn) {
      const ticket = await fetchJiraTicket(conn.hostname, conn.email, conn.apiToken, key);
      stale = new Date(ticket.updated).getTime() > row.generatedAt.getTime();
    }
  } catch {
    // Live staleness check is best-effort — fall back to not-stale rather than blocking the read.
  }
  return toDto(row, stale);
}

export async function updateChecklist(prisma: PrismaClient, ticketKey: string, content: string): Promise<JiraChecklistDto> {
  const row = await prisma.jiraChecklist.update({ where: { ticketKey: ticketKey.toUpperCase() }, data: { content } });
  return toDto(row, false);
}

export async function deleteChecklist(prisma: PrismaClient, ticketKey: string): Promise<boolean> {
  try {
    await prisma.jiraChecklist.delete({ where: { ticketKey: ticketKey.toUpperCase() } });
    return true;
  } catch {
    return false;
  }
}

/** Batch read for the review job — only returns rows that already exist, no on-demand generation. */
export async function getCachedChecklistsForKeys(
  prisma: PrismaClient, keys: string[]
): Promise<Array<{ ticketKey: string; content: string }>> {
  if (keys.length === 0) return [];
  const rows = await prisma.jiraChecklist.findMany({ where: { ticketKey: { in: keys.map((k) => k.toUpperCase()) } } });
  return rows.map((r) => ({ ticketKey: r.ticketKey, content: r.content }));
}
```

- [ ] **Step 4: Add `jira-schemas.ts`**

```ts
import { z } from "zod";

export const searchTicketsQuerySchema = z.object({
  jql: z.string().min(1).optional(),
  projectKey: z.string().min(1).optional(),
  key: z.string().min(1).optional(),
});
export type SearchTicketsQuery = z.infer<typeof searchTicketsQuerySchema>;

export const ticketKeyParamSchema = z.object({
  key: z.string().min(1).max(64),
});
export const ticketKeyChecklistParamSchema = z.object({
  ticketKey: z.string().min(1).max(64),
});

export const updateChecklistBodySchema = z.object({
  content: z.string().min(1, "Content is required"),
});
export type UpdateChecklistBody = z.infer<typeof updateChecklistBodySchema>;

/** Loosely matches PROJECT-123; null/empty clears the override. */
export const setJiraTicketBodySchema = z.object({
  ticketKey: z.string().regex(/^[A-Z][A-Z0-9]+-\d+$/i).nullable(),
});
export type SetJiraTicketBody = z.infer<typeof setJiraTicketBodySchema>;
```

- [ ] **Step 5: Add `jira-routes.ts`**

```ts
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { ZodError } from "zod";
import { Resource, Action } from "@repo-sentinel/types";
import { requireAuth } from "../middleware/auth-middleware.js";
import { requirePermission } from "../middleware/permission-middleware.js";
import { searchTicketsQuerySchema, ticketKeyParamSchema, ticketKeyChecklistParamSchema, updateChecklistBodySchema } from "../schemas/jira-schemas.js";
import { getDecryptedConnection } from "../services/atlassian-connection-service.js";
import { fetchJiraTicket, searchTickets } from "../services/jira-ticket-service.js";
import { getChecklist, generateChecklist, updateChecklist, deleteChecklist } from "../services/jira-checklist-service.js";

function handleZodError(err: ZodError, reply: FastifyReply): void {
  reply.status(400).send({ success: false, error: "Validation failed", details: err.flatten().fieldErrors });
}

export async function registerJiraRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/jira/tickets", { preHandler: [requireAuth, requirePermission(Resource.Atlassian, Action.Read)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = searchTicketsQuerySchema.safeParse(request.query);
      if (!parsed.success) { handleZodError(parsed.error, reply); return; }
      const conn = await getDecryptedConnection(app.prisma);
      if (!conn) { reply.status(400).send({ success: false, error: "No Atlassian connection configured" }); return; }
      try {
        const data = await searchTickets(conn.hostname, conn.email, conn.apiToken, parsed.data);
        reply.send({ success: true, data });
      } catch (err) {
        reply.status(502).send({ success: false, error: err instanceof Error ? err.message : "JIRA search failed" });
      }
    });

  app.get("/api/jira/tickets/:key", { preHandler: [requireAuth, requirePermission(Resource.Atlassian, Action.Read)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = ticketKeyParamSchema.safeParse(request.params);
      if (!parsed.success) { handleZodError(parsed.error, reply); return; }
      const conn = await getDecryptedConnection(app.prisma);
      if (!conn) { reply.status(400).send({ success: false, error: "No Atlassian connection configured" }); return; }
      try {
        const data = await fetchJiraTicket(conn.hostname, conn.email, conn.apiToken, parsed.data.key.toUpperCase());
        reply.send({ success: true, data });
      } catch (err) {
        reply.status(404).send({ success: false, error: err instanceof Error ? err.message : "Ticket not found" });
      }
    });

  app.get("/api/jira/checklists/:ticketKey", { preHandler: [requireAuth, requirePermission(Resource.Atlassian, Action.Read)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = ticketKeyChecklistParamSchema.safeParse(request.params);
      if (!parsed.success) { handleZodError(parsed.error, reply); return; }
      const data = await getChecklist(app.prisma, parsed.data.ticketKey);
      if (!data) { reply.status(404).send({ success: false, error: "Checklist not found" }); return; }
      reply.send({ success: true, data });
    });

  app.post("/api/jira/checklists/:ticketKey/generate", { preHandler: [requireAuth, requirePermission(Resource.Atlassian, Action.Create)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = ticketKeyChecklistParamSchema.safeParse(request.params);
      if (!parsed.success) { handleZodError(parsed.error, reply); return; }
      try {
        const data = await generateChecklist(app.prisma, parsed.data.ticketKey, app.log);
        reply.send({ success: true, data });
      } catch (err) {
        reply.status(502).send({ success: false, error: err instanceof Error ? err.message : "Checklist generation failed" });
      }
    });

  app.put("/api/jira/checklists/:ticketKey", { preHandler: [requireAuth, requirePermission(Resource.Atlassian, Action.Update)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramParsed = ticketKeyChecklistParamSchema.safeParse(request.params);
      const bodyParsed = updateChecklistBodySchema.safeParse(request.body);
      if (!paramParsed.success) { handleZodError(paramParsed.error, reply); return; }
      if (!bodyParsed.success) { handleZodError(bodyParsed.error, reply); return; }
      try {
        const data = await updateChecklist(app.prisma, paramParsed.data.ticketKey, bodyParsed.data.content);
        reply.send({ success: true, data });
      } catch (err) {
        reply.status(404).send({ success: false, error: err instanceof Error ? err.message : "Checklist not found" });
      }
    });

  app.delete("/api/jira/checklists/:ticketKey", { preHandler: [requireAuth, requirePermission(Resource.Atlassian, Action.Delete)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = ticketKeyChecklistParamSchema.safeParse(request.params);
      if (!parsed.success) { handleZodError(parsed.error, reply); return; }
      const deleted = await deleteChecklist(app.prisma, parsed.data.ticketKey);
      if (!deleted) { reply.status(404).send({ success: false, error: "Checklist not found" }); return; }
      reply.send({ success: true, data: { deleted: true } });
    });
}
```

- [ ] **Step 6: Register the route**

In `apps/api/src/index.ts`, import and register `registerJiraRoutes` alongside `registerAtlassianConnectionRoutes`.

- [ ] **Step 7: Run tests and build**

```bash
npm test --workspace=@repo-sentinel/api -- jira-checklist-service.test.ts
npm run build --workspace=@repo-sentinel/api
```

Expected: PASS.

- [ ] **Step 8: Checkpoint**

```bash
git add apps/api/src/schemas/jira-schemas.ts apps/api/src/services/jira-checklist-service.ts apps/api/src/routes/jira-routes.ts apps/api/src/index.ts apps/api/src/__tests__/jira-checklist-service.test.ts
git commit -m "feat: add JIRA checklist generation, CRUD, and routes"
```

### Task 6: PR JIRA Ticket Link Route

**Files:**

- Modify `apps/api/src/schemas/jira-schemas.ts` (already added `setJiraTicketBodySchema` in Task 5)
- Modify `apps/api/src/routes/pull-requests-routes.ts`
- Modify `apps/api/src/services/pull-request-service.ts` (or add a focused function alongside it)

- [ ] **Step 1: Add the service function**

In `apps/api/src/services/pull-request-service.ts`, add:

```ts
export async function setJiraTicketOverride(
  prisma: PrismaClient, prId: string, ticketKey: string | null
): Promise<void> {
  await prisma.pullRequest.update({
    where: { id: prId },
    data: { jiraTicketKeyOverride: ticketKey ? ticketKey.toUpperCase() : null },
  });
}
```

- [ ] **Step 2: Add the route**

In `pull-requests-routes.ts`, add (after the existing `GET /api/pull-requests/:id` handler):

```ts
app.patch(
  "/api/pull-requests/:id/jira-ticket",
  { preHandler: [requireAuth, requirePermission(Resource.PullRequests, Action.Update)] },
  async (request: FastifyRequest, reply: FastifyReply) => {
    const paramParsed = prIdParamSchema.safeParse(request.params);
    if (!paramParsed.success) { handleZodError(paramParsed.error, reply); return; }
    const bodyParsed = setJiraTicketBodySchema.safeParse(request.body);
    if (!bodyParsed.success) { handleZodError(bodyParsed.error, reply); return; }
    try {
      await setJiraTicketOverride(app.prisma, paramParsed.data.id, bodyParsed.data.ticketKey);
      reply.send({ success: true, data: { ticketKey: bodyParsed.data.ticketKey } });
    } catch (err) {
      reply.status(500).send({ success: false, error: err instanceof Error ? err.message : "Failed to update linked ticket" });
    }
  }
);
```

Import `setJiraTicketBodySchema` from `../schemas/jira-schemas.js` and `setJiraTicketOverride` from `../services/pull-request-service.js`.

Note: `Resource.PullRequests, Action.Update` requires the Reviewer permission addition already made in Task 3 Step 6.

- [ ] **Step 3: Build**

Run: `npm run build --workspace=@repo-sentinel/api`

Expected: PASS.

- [ ] **Step 4: Checkpoint**

```bash
git add apps/api/src/routes/pull-requests-routes.ts apps/api/src/services/pull-request-service.ts
git commit -m "feat: add PR JIRA ticket link/override endpoint"
```

### Task 7: AI Review Flow Integration

**Files:**

- Modify `apps/api/src/queues/run-ai-review-job.ts`
- Modify `apps/api/src/services/command-template-service.ts`
- Modify `apps/api/src/services/code-review-json-parser.ts`
- Test `apps/api/src/__tests__/code-review-json-parser.test.ts`

- [ ] **Step 1: Extend `code-review-json-parser.ts`**

```ts
const VALID_SEVERITIES: Set<string> = new Set([
  "critical", "high", "medium", "low", "info",
  "mismatch_requirement", "checklist_required",
]);
```

And in `normalizeResult`, extend the `stats` accumulator:

```ts
const stats = { critical: 0, high: 0, medium: 0, low: 0, info: 0, mismatch_requirement: 0, checklist_required: 0 };
```

The existing `if (sev in stats) stats[sev]++; else stats.info++;` loop needs no other change.

Add/extend `apps/api/src/__tests__/code-review-json-parser.test.ts` with a case asserting a `mismatch_requirement` finding is accepted and counted.

- [ ] **Step 2: Extend `command-template-service.ts`**

In `DEFAULT_TEMPLATE`, append to the Severity Definitions list:

```
- **mismatch_requirement**: code contradicts a requirement stated in a linked JIRA ticket's checklist
- **checklist_required**: a checklist item from a linked JIRA ticket is not addressed by this PR at all
```

In `DEFAULT_SYSTEM_TEMPLATE`, add a new section (parallel to the existing "Open Comments Resolution" section, and update the `severity` enum line in the JSON rules to mention all 7 values):

```
## JIRA Requirement Checklist (if applicable)
If a file named \`jira-checklist.md\` exists in the repo root, it contains checklist items extracted from a JIRA ticket linked to this PR (detected from the PR title/branch, or manually linked). For each item, verify the current code satisfies it. If the code contradicts an item, create a finding with severity \`mismatch_requirement\` referencing the specific file/line. If an item is simply not addressed anywhere in the diff, create a finding with severity \`checklist_required\`. If an item is satisfied, do not flag it. If the file doesn't exist, skip this section entirely.
```

- [ ] **Step 3: Insert step 3c in `run-ai-review-job.ts`**

Insert between the existing `writeOpenCommentsJson` call and the `REVIEWING` phase emit (currently lines 249/252):

```ts
import { resolveTicketKeysForPr } from "../services/jira-ticket-service.js";
import { getCachedChecklistsForKeys } from "../services/jira-checklist-service.js";
import { getSetting } from "../services/settings-service.js";
```

```ts
  // 3c. Best-effort: inject any cached JIRA checklist(s) for this PR's linked ticket(s)
  try {
    const jiraEnabled = await getSetting("ai.review.jiraEnabled", "0");
    if (jiraEnabled === "1") {
      const ticketKeys = await resolveTicketKeysForPr(fastify.prisma, {
        jiraTicketKeyOverride: pr.jiraTicketKeyOverride, title: pr.title, body: pr.body, headRef: pr.headRef,
      });
      if (ticketKeys.length === 0) {
        emitLog(fastify.io, roomId, `[REVIEWING] No JIRA ticket found`);
      } else {
        const checklists = await getCachedChecklistsForKeys(fastify.prisma, ticketKeys);
        if (checklists.length > 0) {
          const combined = checklists.map((c) => `## ${c.ticketKey}\n\n${c.content}`).join("\n\n---\n\n");
          await writeFile(join(repoPath, "jira-checklist.md"), combined, "utf-8");
          emitLog(fastify.io, roomId, `[REVIEWING] JIRA checklist(s) injected (${checklists.length}): ${checklists.map((c) => c.ticketKey).join(", ")}`);
        } else {
          emitLog(fastify.io, roomId, `[REVIEWING] JIRA ticket(s) found (${ticketKeys.join(", ")}) but no checklist generated — generate one from the JIRA page`);
        }
      }
    }
  } catch (err) {
    log.warn({ err }, "[jira] non-blocking failure while injecting checklist");
  }
```

Add `writeFile` to the existing `node:fs/promises` import (the file already imports `unlink` from there).

- [ ] **Step 4: Build**

Run: `npm run build --workspace=@repo-sentinel/api`

Expected: PASS.

- [ ] **Step 5: Run tests**

```bash
npm test --workspace=@repo-sentinel/api -- code-review-json-parser.test.ts
```

Expected: PASS.

- [ ] **Step 6: Checkpoint**

```bash
git add apps/api/src/queues/run-ai-review-job.ts apps/api/src/services/command-template-service.ts apps/api/src/services/code-review-json-parser.ts apps/api/src/__tests__/code-review-json-parser.test.ts
git commit -m "feat: inject JIRA checklist into review prompt and flow"
```

### Task 8: Settings Seed and Settings Page

**Files:**

- Modify `apps/api/src/services/settings-seed-service.ts`
- Modify `apps/api/src/schemas/settings-schemas.ts`
- Modify `apps/web/src/app/features/settings/settings-page/settings-page.ts`
- Modify `apps/web/src/app/features/settings/settings-page/settings-page.html`

- [ ] **Step 1: Seed the two new settings**

In `settings-seed-service.ts`, add to `DEFAULT_SETTINGS`:

```ts
{ key: "ai.review.jiraEnabled", value: "0" },
{ key: "ai.review.jiraTicketPattern", value: "[A-Z][A-Z0-9]+-\\d+" },
```

- [ ] **Step 2: Validate the regex setting**

In `settings-schemas.ts`'s `validateSettingValue`, add:

```ts
if (key === "ai.review.jiraTicketPattern") {
  try { new RegExp(value); } catch { return "ai.review.jiraTicketPattern must be a valid regular expression"; }
}
```

- [ ] **Step 3: Add JIRA fields to the settings page**

In `settings-page.ts`, add signals and load/save wiring following the exact pattern of `autoPostToGithub`/`autoPostSeverities`:

```ts
readonly jiraEnabled = signal(false);
readonly jiraTicketPattern = signal('[A-Z][A-Z0-9]+-\\d+');
```

In `load()`:

```ts
this.jiraEnabled.set(settings['ai.review.jiraEnabled'] === '1');
this.jiraTicketPattern.set(settings['ai.review.jiraTicketPattern'] ?? '[A-Z][A-Z0-9]+-\\d+');
```

In `save()`'s `values` map:

```ts
'ai.review.jiraEnabled': this.jiraEnabled() ? '1' : '0',
'ai.review.jiraTicketPattern': this.jiraTicketPattern(),
```

- [ ] **Step 4: Add the JIRA section to the template**

In `settings-page.html`, add a new `mat-card` section (mirroring the existing "Auto-Post to GitHub" card) with a `mat-slide-toggle` bound to `jiraEnabled` and a text input bound to `jiraTicketPattern`.

- [ ] **Step 5: Run web build**

Run: `npm run build --workspace=@repo-sentinel/web`

Expected: PASS.

- [ ] **Step 6: Checkpoint**

```bash
git add apps/api/src/services/settings-seed-service.ts apps/api/src/schemas/settings-schemas.ts apps/web/src/app/features/settings/settings-page/settings-page.ts apps/web/src/app/features/settings/settings-page/settings-page.html
git commit -m "feat: add JIRA settings toggle and ticket pattern field"
```

### Task 9: Frontend Atlassian Connection Card

**Files:**

- Create `apps/web/src/app/features/connections/atlassian-connections.service.ts`
- Create `apps/web/src/app/features/connections/atlassian-connection-form-dialog/atlassian-connection-form-dialog.ts`
- Create `apps/web/src/app/features/connections/atlassian-connection-form-dialog/atlassian-connection-form-dialog.html`
- Create `apps/web/src/app/features/connections/atlassian-connection-form-dialog/atlassian-connection-form-dialog.scss`
- Modify `apps/web/src/app/features/connections/connections-page/connections-page.ts`
- Modify `apps/web/src/app/features/connections/connections-page/connections-page.html`

- [ ] **Step 1: Add the service**

Mirror `connections.service.ts`, but singleton (no id params, `get`/`replace`/`remove`/`test`):

```ts
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse, AtlassianConnectionDto, AtlassianConnectionTestResult } from '../../core/models/dto';

export interface ReplaceAtlassianConnectionInput {
  hostname: string;
  email: string;
  apiToken: string;
}

@Injectable({ providedIn: 'root' })
export class AtlassianConnectionsService {
  private readonly http = inject(HttpClient);

  async get(): Promise<AtlassianConnectionDto | null> {
    const res = await firstValueFrom(this.http.get<ApiResponse<AtlassianConnectionDto | null>>('/api/atlassian/connection'));
    return res.data;
  }

  async replace(input: ReplaceAtlassianConnectionInput): Promise<AtlassianConnectionDto> {
    const res = await firstValueFrom(this.http.put<ApiResponse<AtlassianConnectionDto>>('/api/atlassian/connection', input));
    return res.data;
  }

  async remove(): Promise<void> {
    await firstValueFrom(this.http.delete('/api/atlassian/connection'));
  }

  async test(): Promise<AtlassianConnectionTestResult> {
    const res = await firstValueFrom(this.http.post<ApiResponse<AtlassianConnectionTestResult>>('/api/atlassian/connection/test', {}));
    return res.data;
  }

  async testTicket(ticketKey: string): Promise<unknown> {
    const res = await firstValueFrom(this.http.post<ApiResponse<unknown>>('/api/atlassian/connection/test-ticket', { ticketKey }));
    return res.data;
  }
}
```

- [ ] **Step 2: Add the form dialog**

Mirror `connection-form-dialog.ts`/`.html`/`.scss` exactly, swapping `username` → `email`, `token` → `apiToken`, and calling `AtlassianConnectionsService.replace(...)` instead of `.create(...)`.

- [ ] **Step 3: Add the card to the connections page**

In `connections-page.ts`, inject `AtlassianConnectionsService`, add:

```ts
readonly atlassianConnection = signal<AtlassianConnectionDto | null>(null);
readonly atlassianTesting = signal(false);
readonly atlassianTestResult = signal<string | null>(null);
readonly canCreateAtlassian = this.permissions.can(Resource.Atlassian, Action.Create);
readonly canDeleteAtlassian = this.permissions.can(Resource.Atlassian, Action.Delete);
```

Load it alongside the existing GHE connections in `load()`, add `openAtlassianDialog()`, `removeAtlassian()`, `testAtlassian()` methods (mirroring the GHE ones, singleton-shaped).

In `connections-page.html`, add a second `mat-card` titled "Atlassian Connection" showing connected/not-connected state with Add/Edit/Test/Delete actions (Add when `atlassianConnection() === null`, Edit/Test/Delete otherwise).

- [ ] **Step 4: Run web build**

Run: `npm run build --workspace=@repo-sentinel/web`

Expected: PASS.

- [ ] **Step 5: Checkpoint**

```bash
git add apps/web/src/app/features/connections
git commit -m "feat: add Atlassian connection card to connections page"
```

### Task 10: Frontend JIRA Module

**Files:**

- Create `apps/web/src/app/features/jira/jira.service.ts`
- Create `apps/web/src/app/features/jira/jira-page/jira-page.ts`
- Create `apps/web/src/app/features/jira/jira-page/jira-page.html`
- Create `apps/web/src/app/features/jira/jira-page/jira-page.scss`
- Create `apps/web/src/app/features/jira/jira-ticket-detail/jira-ticket-detail.ts`
- Create `apps/web/src/app/features/jira/jira-ticket-detail/jira-ticket-detail.html`
- Create `apps/web/src/app/features/jira/jira-ticket-detail/jira-ticket-detail.scss`
- Modify `apps/web/src/app/app.routes.ts`
- Modify `apps/web/src/app/layout/sidebar-nav/sidebar-nav.ts`

- [ ] **Step 1: Add `jira.service.ts`**

```ts
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse, JiraChecklistDto, JiraTicketDto } from '../../core/models/dto';

export interface SearchTicketsFilter {
  jql?: string;
  projectKey?: string;
  key?: string;
}

@Injectable({ providedIn: 'root' })
export class JiraService {
  private readonly http = inject(HttpClient);

  async searchTickets(filter: SearchTicketsFilter): Promise<JiraTicketDto[]> {
    const params = new URLSearchParams();
    if (filter.jql) params.set('jql', filter.jql);
    if (filter.projectKey) params.set('projectKey', filter.projectKey);
    if (filter.key) params.set('key', filter.key);
    const res = await firstValueFrom(this.http.get<ApiResponse<JiraTicketDto[]>>(`/api/jira/tickets?${params}`));
    return res.data;
  }

  async getTicket(key: string): Promise<JiraTicketDto> {
    const res = await firstValueFrom(this.http.get<ApiResponse<JiraTicketDto>>(`/api/jira/tickets/${key}`));
    return res.data;
  }

  async getChecklist(ticketKey: string): Promise<JiraChecklistDto | null> {
    try {
      const res = await firstValueFrom(this.http.get<ApiResponse<JiraChecklistDto>>(`/api/jira/checklists/${ticketKey}`));
      return res.data;
    } catch {
      return null;
    }
  }

  async generateChecklist(ticketKey: string): Promise<JiraChecklistDto> {
    const res = await firstValueFrom(this.http.post<ApiResponse<JiraChecklistDto>>(`/api/jira/checklists/${ticketKey}/generate`, {}));
    return res.data;
  }

  async updateChecklist(ticketKey: string, content: string): Promise<JiraChecklistDto> {
    const res = await firstValueFrom(this.http.put<ApiResponse<JiraChecklistDto>>(`/api/jira/checklists/${ticketKey}`, { content }));
    return res.data;
  }

  async deleteChecklist(ticketKey: string): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/jira/checklists/${ticketKey}`));
  }
}
```

- [ ] **Step 2: Build `jira-page`**

Standalone component (mirrors `connections-page.ts`'s shape): a search form (JQL / project key / exact key text inputs), a results table (key, summary, status columns) using `MatTableModule`, and a row-click handler that opens `JiraTicketDetail` in a `MatDialog` (or navigates to a side panel — a dialog is simpler and matches the existing dialog-based UI pattern in this repo). Gate visibility of nothing extra — the route itself is already gated on `Atlassian:Read`.

- [ ] **Step 3: Build `jira-ticket-detail`**

Dialog component taking a ticket key as `MAT_DIALOG_DATA`. On open, loads the ticket (description) and its checklist (`null` if none generated). Renders: ticket summary/description/status, and a checklist section with a read-only view, an "Edit" toggle → `<textarea>` bound to content with Save (`updateChecklist`), and Generate/Regenerate (`generateChecklist`) and Delete (`deleteChecklist`) buttons gated on `Atlassian:Create`/`Update`/`Delete` respectively. Show a "stale" chip (reuse `.chip-warn` from `styles.scss`) when `checklist.stale` is true.

- [ ] **Step 4: Add the route**

In `app.routes.ts`, add under the `AppShell` children (after `settings`):

```ts
{
  path: 'jira',
  canActivate: [permissionGuard],
  data: { resource: Resource.Atlassian, action: Action.Read },
  loadComponent: () => import('./features/jira/jira-page/jira-page').then((m) => m.JiraPage),
},
```

- [ ] **Step 5: Add the sidebar nav entry**

In `sidebar-nav.ts`'s `NAV_ITEMS`, add:

```ts
{ path: '/jira', label: 'JIRA', icon: 'assignment', resource: Resource.Atlassian },
```

(after Pull Requests, before Settings — matches the nav ordering vs. route registration order).

- [ ] **Step 6: Run web build**

Run: `npm run build --workspace=@repo-sentinel/web`

Expected: PASS.

- [ ] **Step 7: Checkpoint**

```bash
git add apps/web/src/app/features/jira apps/web/src/app/app.routes.ts apps/web/src/app/layout/sidebar-nav/sidebar-nav.ts
git commit -m "feat: add JIRA ticket browser and checklist page"
```

### Task 11: PR-Detail Linked Ticket Panel

**Files:**

- Modify `apps/web/src/app/features/pull-request-detail/reviews.service.ts`
- Modify `apps/web/src/app/features/pull-request-detail/pull-request-detail-page/pull-request-detail-page.ts`
- Modify `apps/web/src/app/features/pull-request-detail/pull-request-detail-page/pull-request-detail-page.html`

- [ ] **Step 1: Add the API method**

In `reviews.service.ts` (or a one-line addition next to `PullRequestsService` — either is fine since the route lives under `/api/pull-requests/:id/jira-ticket`; keep it in `ReviewsService` to match where the other PR-detail-page API calls already live):

```ts
async setJiraTicket(prId: string, ticketKey: string | null): Promise<{ ticketKey: string | null }> {
  const res = await firstValueFrom(
    this.http.patch<ApiResponse<{ ticketKey: string | null }>>(`/api/pull-requests/${prId}/jira-ticket`, { ticketKey })
  );
  return res.data;
}
```

- [ ] **Step 2: Add panel state and handler**

In `pull-request-detail-page.ts`, add:

```ts
readonly editingJiraTicket = signal(false);
readonly jiraTicketDraft = signal('');
readonly canUpdateJiraTicket = this.permissions.can(Resource.PullRequests, Action.Update);

async onSaveJiraTicket(): Promise<void> {
  const draft = this.jiraTicketDraft().trim();
  this.actionBusy.set(true);
  try {
    await this.reviewsService.setJiraTicket(this.prId, draft || null);
    const pr = await this.pullRequestsService.detail(this.prId);
    this.pr.set(pr);
    this.editingJiraTicket.set(false);
  } catch (err) {
    this.snackBar.open(extractErrorMessage(err, 'Failed to update linked ticket'), 'Dismiss', { duration: 5000 });
  } finally {
    this.actionBusy.set(false);
  }
}
```

- [ ] **Step 3: Render the panel**

In `pull-request-detail-page.html`, add a small card near the top (alongside the existing PR summary area): show `pr()!.jiraTicketKeyOverride` if set, else "not linked"; a link to `/jira?key=<ticketKey>` when a key is known; and, when `canUpdateJiraTicket`, a "Change ticket" control (text input + Save, backed by `editingJiraTicket`/`jiraTicketDraft`/`onSaveJiraTicket`) plus a "Clear" action calling `setJiraTicket(prId, null)`.

Note: this panel only shows the manual override, not auto-detected keys — auto-detection happens server-side at review time via `resolveTicketKeysForPr`. If the override is unset, label it "auto-detected from title/branch (or none found)" rather than trying to run the regex client-side.

- [ ] **Step 4: Run web build**

Run: `npm run build --workspace=@repo-sentinel/web`

Expected: PASS.

- [ ] **Step 5: Checkpoint**

```bash
git add apps/web/src/app/features/pull-request-detail/reviews.service.ts apps/web/src/app/features/pull-request-detail/pull-request-detail-page
git commit -m "feat: add linked JIRA ticket panel to PR detail"
```

### Task 12: Final Verification

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

Start API/web via the repo's normal dev workflow (`npm run dev`). Then:

1. As Admin, go to Connections → add an Atlassian connection (real or sandbox `*.atlassian.net` site) → Test succeeds.
2. Go to Settings → JIRA section → enable `ai.review.jiraEnabled`, confirm the pattern field saves.
3. Go to JIRA page → search a project/JQL → open a ticket → Generate checklist → confirm content appears and is editable.
4. Open a PR whose title/branch contains a matching ticket key → confirm the PR-detail linked-ticket panel shows it; manually override to a different key, save, then clear back to auto-detect.
5. Trigger a review on that PR → confirm the terminal shows a `[REVIEWING] JIRA checklist(s) injected` (or "found but no checklist") line, and that it doesn't block the review if JIRA is disabled/unlinked/ungenerated.
6. As Viewer, confirm the JIRA page and connection card render read-only (no Add/Edit/Delete/Generate actions).

- [ ] **Step 7: Final checkpoint**

```bash
git status --short
git commit -m "feat: complete JIRA/Atlassian integration"
```

Only run the final commit if there are remaining staged changes not covered by earlier checkpoints.

## Self-Review

Spec coverage:

- Data model (`AtlassianConnection`, `JiraChecklist`, `PullRequest.jiraTicketKeyOverride`, `Resource.Atlassian`, `FindingSeverity` additions, DTOs): Task 1.
- SSRF-safe hostname validation + trimmed API client: Task 2.
- Singleton connection service/routes + RBAC seeding: Task 3.
- Ticket-key auto-detection/override, ticket fetch, ticket search: Task 4.
- Checklist generation/CRUD (DB-backed) + JIRA routes: Task 5.
- Manual PR↔ticket link endpoint: Task 6.
- Review-flow checklist injection, new severities in prompt + JSON parser: Task 7.
- Settings (`jiraEnabled`, `jiraTicketPattern`) + Settings UI: Task 8.
- Atlassian connection card + form dialog: Task 9.
- JIRA browser page + ticket/checklist detail + nav/route: Task 10.
- PR-detail linked-ticket panel: Task 11.
- Full-stack verification + manual smoke test: Task 12.

Placeholder scan:

- `stripHtml`/`adfToPlainText` bodies in Task 4 Step 3 are explicitly called out as elided-for-readability with an instruction to port the real implementations from the reference file — flagged inline so the executing agent does not leave them as stubs.
- No other placeholder implementations found in executable steps.

Type consistency:

- `AtlassianConnectionDto`/`JiraTicketDto`/`JiraChecklistDto` are defined once in `packages/types` (Task 1) before any service/route/frontend task references them, and hand-ported into the Angular `dto.ts` in the same task, matching this repo's existing `GheConnectionDto` convention.
- `FindingSeverity` and `PullRequestDto.jiraTicketKeyOverride` changes land in Task 1 before `code-review-json-parser.ts` (Task 7) and the PR-detail panel (Task 11) depend on them.
- Route → service → frontend-service naming is consistent end-to-end (e.g. `getCachedChecklistsForKeys` used identically in Task 5's service and Task 7's job integration).
