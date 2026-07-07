/**
 * DTOs and input types for watched repository management.
 */

export interface WatchedRepoDto {
  id: string;
  connectionId: string;
  owner: string;
  name: string;
  fullName: string;
  pollingInterval: number;
  lastPolledAt: string | null;
  isActive: boolean;
  /** Computed by API from isActive + lastPollStatus. */
  status: "active" | "paused" | "error";
  createdAt: string;
  /** Repo-specific user prompt template (null = use global AppSetting) */
  promptTemplate: string | null;
  /** Repo-specific system prompt template (null = use global AppSetting) */
  systemPromptTemplate: string | null;
  /** Count of currently open PRs — included on repo list. */
  openPrCount?: number;
}

export interface WatchRepoItemInput {
  owner: string;
  name: string;
  fullName: string;
}

export interface WatchReposInput {
  connectionId: string;
  repos: WatchRepoItemInput[];
}

export interface UpdateRepoInput {
  pollingInterval?: number;
  isActive?: boolean;
  /** Set to string to customize; null to reset to global; undefined to leave unchanged */
  promptTemplate?: string | null;
  /** Set to string to customize; null to reset to global; undefined to leave unchanged */
  systemPromptTemplate?: string | null;
}

/** Raw repo object returned from GHE API listing */
export interface GheRepoItem {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  private: boolean;
  description: string | null;
  updatedAt: string;
}

export interface BrowseReposResponse {
  repos: GheRepoItem[];
  page: number;
  hasMore: boolean;
}
