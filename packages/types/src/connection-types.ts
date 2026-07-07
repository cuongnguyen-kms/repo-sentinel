/**
 * DTOs and input types for GHE connection management.
 * NOTE: token is NEVER included in response DTOs — only in create input.
 */

export interface GheConnectionDto {
  id: string;
  hostname: string;
  username: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateConnectionInput {
  hostname: string;
  username: string;
  /** Raw PAT — encrypted before storage, never returned in responses */
  token: string;
}

export interface ConnectionTestResult {
  success: boolean;
  message: string;
  username?: string;
}
