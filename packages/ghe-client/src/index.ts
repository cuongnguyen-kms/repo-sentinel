/**
 * GheClient — typed wrapper around Octokit for GitHub Enterprise Server.
 *
 * All methods return typed results and handle GHE-specific quirks
 * (ETag conditional requests, diff Accept header, pagination).
 */

import { createGheOctokit } from "./octokit-factory.js";
import {
  LIST_REVIEW_THREADS_QUERY,
  RESOLVE_THREAD_MUTATION,
} from "./graphql-operations.js";
import type {
  GheUser,
  GheRepo,
  GhePullRequest,
  GheListPrResult,
  GheCompareResult,
  GheCompareFile,
  ListPullRequestsOptions,
} from "./types.js";
import type { ConnectionTestResult } from "@repo-sentinel/types";

export class GheClient {
  private readonly octokit: ReturnType<typeof createGheOctokit>;

  constructor(hostname: string, token: string) {
    this.octokit = createGheOctokit(hostname, token);
  }

  /**
   * Validate the token by fetching the authenticated user.
   * Used during connection creation to confirm credentials work.
   */
  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const { data } = await this.octokit.rest.users.getAuthenticated();
      return {
        success: true,
        message: `Connected as ${data.login}`,
        username: data.login,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return { success: false, message };
    }
  }

  /**
   * List repositories accessible to the authenticated user.
   *
   * @param page    - 1-based page number (default 1)
   * @param perPage - Results per page, max 100 (default 30)
   */
  async listRepos(page = 1, perPage = 30): Promise<GheRepo[]> {
    const { data } = await this.octokit.rest.repos.listForAuthenticatedUser({
      page,
      per_page: perPage,
      sort: "updated",
    });
    return data as GheRepo[];
  }

  /**
   * Search repositories accessible to the authenticated user by name/full_name.
   * Fetches a page and filters client-side by query string (case-insensitive).
   *
   * @param query   - Search string to match against repo name or full_name
   * @param page    - 1-based page number (default 1)
   * @param perPage - Results per page, max 100 (default 30)
   */
  async searchRepos(
    query: string,
    page = 1,
    perPage = 30
  ): Promise<GheRepo[]> {
    const { data } = await this.octokit.rest.repos.listForAuthenticatedUser({
      page,
      per_page: perPage,
      sort: "updated",
    });
    const lower = query.toLowerCase();
    return (data as GheRepo[]).filter(
      (r) =>
        r.name.toLowerCase().includes(lower) ||
        r.full_name.toLowerCase().includes(lower)
    );
  }

  /**
   * List pull requests for a repository with ETag-based conditional requests.
   * When the server returns 304 Not Modified, `notModified` is true and
   * `pullRequests` is empty — callers should skip processing.
   */
  async listPullRequests(
    owner: string,
    repo: string,
    opts: ListPullRequestsOptions = {}
  ): Promise<GheListPrResult> {
    const { state = "open", page = 1, perPage = 100, etag } = opts;

    const headers: Record<string, string> = {};
    if (etag) {
      headers["If-None-Match"] = etag;
    }

    try {
      const response = await this.octokit.request(
        "GET /repos/{owner}/{repo}/pulls",
        {
          owner,
          repo,
          state,
          page,
          per_page: perPage,
          headers,
        }
      );

      // List endpoint omits additions/deletions/changed_files — those require
      // a separate getPullRequest() call. Cast via unknown is intentional.
      return {
        pullRequests: response.data as unknown as GhePullRequest[],
        etag: (response.headers as Record<string, string>)["etag"] ?? null,
        notModified: false,
      };
    } catch (err: unknown) {
      // Octokit throws for 304 when If-None-Match was sent
      if (
        typeof err === "object" &&
        err !== null &&
        "status" in err &&
        (err as { status: number }).status === 304
      ) {
        return { pullRequests: [], etag: etag ?? null, notModified: true };
      }
      throw err;
    }
  }

  /**
   * Fetch a single pull request with full detail (includes additions/deletions).
   */
  async getPullRequest(
    owner: string,
    repo: string,
    pullNumber: number
  ): Promise<GhePullRequest> {
    const { data } = await this.octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: pullNumber,
    });
    return data as unknown as GhePullRequest;
  }

  /**
   * Fetch the unified diff for a pull request.
   * Uses the `application/vnd.github.diff` Accept header.
   */
  async getPullRequestDiff(
    owner: string,
    repo: string,
    pullNumber: number
  ): Promise<string> {
    const response = await this.octokit.request(
      "GET /repos/{owner}/{repo}/pulls/{pull_number}",
      {
        owner,
        repo,
        pull_number: pullNumber,
        headers: {
          Accept: "application/vnd.github.diff",
        },
      }
    );
    return response.data as unknown as string;
  }

  /**
   * Post a single review comment on a pull request (standalone, not part of a review).
   * Uses modern `line` + `side` API (not deprecated `position`).
   */
  async createReviewComment(
    owner: string,
    repo: string,
    pullNumber: number,
    params: {
      commitId: string;
      path: string;
      /** Required for inline comments, omit for file-level */
      line?: number;
      side?: "LEFT" | "RIGHT";
      body: string;
      startLine?: number;
      startSide?: "LEFT" | "RIGHT";
      /** When "file", comment attaches to the file header instead of a diff line */
      subjectType?: "file";
    }
  ): Promise<{ id: number; html_url: string }> {
    const { data } = await this.octokit.rest.pulls.createReviewComment({
      owner,
      repo,
      pull_number: pullNumber,
      commit_id: params.commitId,
      path: params.path,
      body: params.body,
      ...(params.subjectType === "file"
        ? { subject_type: "file" as const }
        : {
            line: params.line!,
            side: params.side ?? "RIGHT",
            ...(params.startLine && {
              start_line: params.startLine,
              start_side: params.startSide ?? "RIGHT",
            }),
          }),
    });
    return { id: data.id, html_url: data.html_url };
  }

  /**
   * Submit a pull request review with multiple inline comments and a review event.
   * Uses the batch review API to post all comments atomically.
   */
  async createReview(
    owner: string,
    repo: string,
    pullNumber: number,
    params: {
      commitId: string;
      event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
      body?: string;
      comments: Array<{
        path: string;
        line: number;
        side?: "LEFT" | "RIGHT";
        body: string;
        start_line?: number;
        start_side?: "LEFT" | "RIGHT";
      }>;
    }
  ): Promise<{ id: number; html_url: string }> {
    const { data } = await this.octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number: pullNumber,
      commit_id: params.commitId,
      event: params.event,
      body: params.body,
      comments: params.comments.map((c) => ({
        path: c.path,
        line: c.line,
        side: c.side ?? ("RIGHT" as const),
        body: c.body,
        ...(c.start_line && {
          start_line: c.start_line,
          start_side: c.start_side ?? ("RIGHT" as const),
        }),
      })),
    });
    return { id: data.id, html_url: data.html_url };
  }

  /**
   * Fetch a single PR review comment by ID.
   * Returns null if the comment no longer exists (404), throws on other errors.
   */
  async getReviewComment(
    owner: string,
    repo: string,
    commentId: number
  ): Promise<{ id: number; html_url: string } | null> {
    try {
      const { data } = await this.octokit.rest.pulls.getReviewComment({
        owner,
        repo,
        comment_id: commentId,
      });
      return { id: data.id, html_url: data.html_url };
    } catch (err: unknown) {
      if (
        typeof err === "object" &&
        err !== null &&
        "status" in err &&
        (err as { status: number }).status === 404
      ) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Delete a PR review comment on GitHub.
   * Returns true if deleted (204), false if already gone (404).
   */
  async deleteReviewComment(
    owner: string,
    repo: string,
    commentId: number
  ): Promise<boolean> {
    try {
      await this.octokit.rest.pulls.deleteReviewComment({
        owner,
        repo,
        comment_id: commentId,
      });
      return true;
    } catch (err: unknown) {
      if (
        typeof err === "object" &&
        err !== null &&
        "status" in err &&
        (err as { status: number }).status === 404
      ) {
        return false;
      }
      throw err;
    }
  }

  /** Expose the underlying authenticated user for re-use */
  async getAuthenticatedUser(): Promise<GheUser> {
    const { data } = await this.octokit.rest.users.getAuthenticated();
    return data as unknown as GheUser;
  }

  /**
   * Compare two commits in a repository.
   * Used for auto-resolution: determine which files changed between
   * the commit a review was pinned to and the latest head commit.
   */
  async compareCommits(
    owner: string,
    repo: string,
    base: string,
    head: string
  ): Promise<GheCompareResult> {
    const { data } = await this.octokit.rest.repos.compareCommits({
      owner,
      repo,
      base,
      head,
    });
    return {
      status: data.status as GheCompareResult["status"],
      ahead_by: data.ahead_by,
      behind_by: data.behind_by,
      total_commits: data.total_commits,
      files: (data.files ?? []).map((f) => ({
        filename: f.filename ?? "",
        status: (f.status ?? "modified") as GheCompareFile["status"],
        additions: f.additions ?? 0,
        deletions: f.deletions ?? 0,
        patch: f.patch,
      })),
    };
  }
  /**
   * List all review threads for a PR via GraphQL.
   * Returns thread node IDs, resolution status, and first comment database ID.
   */
  async listReviewThreads(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<Array<{ threadNodeId: string; isResolved: boolean; firstCommentDatabaseId: number | null }>> {
    interface ThreadsResponse {
      repository: {
        pullRequest: {
          reviewThreads: {
            nodes: Array<{
              id: string;
              isResolved: boolean;
              comments: { nodes: Array<{ databaseId: number | null }> };
            }>;
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
          };
        };
      };
    }

    const threads: Array<{ threadNodeId: string; isResolved: boolean; firstCommentDatabaseId: number | null }> = [];
    let cursor: string | null = null;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const gqlResult: ThreadsResponse = await this.octokit.graphql(
        LIST_REVIEW_THREADS_QUERY,
        { owner, repo, prNumber, cursor }
      );

      const page = gqlResult.repository.pullRequest.reviewThreads;
      for (const node of page.nodes) {
        threads.push({
          threadNodeId: node.id,
          isResolved: node.isResolved,
          firstCommentDatabaseId: node.comments.nodes[0]?.databaseId ?? null,
        });
      }

      if (!page.pageInfo.hasNextPage) break;
      cursor = page.pageInfo.endCursor;
    }

    return threads;
  }

  /**
   * Resolve a single review thread on GitHub via GraphQL mutation.
   * Returns true if resolved successfully.
   */
  async resolveReviewThread(threadNodeId: string): Promise<boolean> {
    interface ResolveResponse {
      resolveReviewThread: { thread: { id: string; isResolved: boolean } };
    }
    const gqlResult: ResolveResponse = await this.octokit.graphql(
      RESOLVE_THREAD_MUTATION,
      { threadId: threadNodeId }
    );
    return gqlResult.resolveReviewThread.thread.isResolved;
  }
}

// Re-export types so consumers can import from one place
export type {
  GheUser,
  GheRepo,
  GhePullRequest,
  GheListPrResult,
  GheCompareResult,
  GheCompareFile,
  ListPullRequestsOptions,
} from "./types.js";
