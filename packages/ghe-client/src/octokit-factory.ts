/**
 * Creates an Octokit instance configured for GitHub.com or a GitHub Enterprise Server instance.
 * - github.com uses Octokit's default base URL (https://api.github.com)
 * - GHE uses https://{hostname}/api/v3
 */

import { Octokit } from "@octokit/rest";

/** Hostnames that should use the public GitHub API (no custom baseUrl). */
const GITHUB_COM_HOSTS = ["github.com", "www.github.com"];

/**
 * Build an authenticated Octokit client for GitHub.com or a GHE instance.
 *
 * @param hostname - e.g. "github.com" or "ghe.corp.com" (no protocol, no trailing slash)
 * @param token    - Personal access token (PAT)
 */
export function createGheOctokit(hostname: string, token: string): Octokit {
  const isGithubCom = GITHUB_COM_HOSTS.includes(hostname.toLowerCase());

  return new Octokit({
    auth: token,
    // github.com → default https://api.github.com; GHE → custom base URL
    ...(isGithubCom ? {} : { baseUrl: `https://${hostname}/api/v3` }),
  });
}
