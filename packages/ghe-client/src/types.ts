/**
 * GHE-specific API response types.
 * These mirror the GitHub REST API shape for the fields we use.
 */

export interface GheUser {
  login: string;
  id: number;
  avatar_url: string;
  name: string | null;
  email: string | null;
}

export interface GheRepo {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string; avatar_url: string };
  private: boolean;
  html_url: string;
  description: string | null;
  updated_at: string;
  default_branch: string;
  open_issues_count: number;
}

export interface GhePullRequest {
  id: number;
  number: number;
  node_id: string;
  title: string;
  body: string | null;
  state: "open" | "closed";
  html_url: string;
  diff_url: string;
  user: { login: string; avatar_url: string };
  head: { ref: string; sha: string };
  base: { ref: string; sha: string };
  merged_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  additions: number;
  deletions: number;
  changed_files: number;
  draft?: boolean;
}

export interface ListPullRequestsOptions {
  state?: "open" | "closed" | "all";
  page?: number;
  perPage?: number;
  /** ETag from previous response for conditional requests (304 optimization) */
  etag?: string;
}

export interface GheListPrResult {
  pullRequests: GhePullRequest[];
  /** Updated ETag for next conditional request */
  etag: string | null;
  /** True when server returned 304 Not Modified — data unchanged */
  notModified: boolean;
}

export interface GheCompareFile {
  filename: string;
  status: "added" | "removed" | "modified" | "renamed" | "copied" | "changed" | "unchanged";
  additions: number;
  deletions: number;
  /** Unified diff patch — absent for binary files */
  patch?: string;
}

export interface GheCompareResult {
  status: "behind" | "ahead" | "diverged" | "identical";
  ahead_by: number;
  behind_by: number;
  total_commits: number;
  files: GheCompareFile[];
}
