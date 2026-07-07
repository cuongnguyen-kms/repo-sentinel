/**
 * Git checkout service for AI review local repo management.
 *
 * Clones or updates repos at {basePath}/{hostname}/{owner}/{repo}.
 * Token is stripped from remote URL immediately after clone to prevent
 * credential leakage in .git/config.
 *
 * Security: sanitizePathComponent blocks path traversal characters.
 */

import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { simpleGit, type SimpleGit, type SimpleGitOptions } from "simple-git";
import { prisma } from "@repo-sentinel/db";
import type { GheConnection, WatchedRepo } from "@repo-sentinel/db";

const CHECKOUT_SETTING_KEY = "ai.review.checkoutBasePath";
/** Block path traversal and shell-special characters */
const FORBIDDEN_CHARS = /[/\\~\0]/;

const DEFAULT_CHECKOUT_BASE_PATH = path.join(os.homedir(), "repo-sentinel-repos");

/** Expand leading `~` to home directory (path.join does not do this). */
function expandTilde(p: string): string {
  if (p === "~" || p.startsWith("~/") || p.startsWith("~\\")) {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

/** Read checkout base path from AppSetting. Falls back to ~/repo-sentinel-repos. */
export async function getCheckoutBasePath(): Promise<string> {
  const setting = await prisma.appSetting.findUnique({
    where: { key: CHECKOUT_SETTING_KEY },
  });
  const raw = setting?.value?.trim() || DEFAULT_CHECKOUT_BASE_PATH;
  return expandTilde(raw);
}

/** Reject path components that could enable traversal attacks. */
export function sanitizePathComponent(input: string, label: string): string {
  if (!input || input.includes("..") || FORBIDDEN_CHARS.test(input)) {
    throw new Error(`Invalid ${label}: "${input}"`);
  }
  return input;
}

/** Compute repo directory: {basePath}/{hostname}/{owner}/{repo} */
export function getRepoPath(
  basePath: string,
  hostname: string,
  owner: string,
  repoName: string
): string {
  return path.join(
    basePath,
    sanitizePathComponent(hostname, "hostname"),
    sanitizePathComponent(owner, "owner"),
    sanitizePathComponent(repoName, "repo name")
  );
}

/** Checkout a branch, creating local tracking branch from remote if needed. */
async function checkoutBranch(git: SimpleGit, branch: string): Promise<void> {
  try {
    await git.checkout(branch);
  } catch {
    // Branch doesn't exist locally yet — create tracking branch from remote
    await git.checkout(["-b", branch, `origin/${branch}`]);
  }
  await git.reset(["--hard", `origin/${branch}`]);
}

/**
 * Ensure the repo is cloned and the given branch is checked out.
 * Returns the absolute path to the repo directory.
 *
 * - First call: clones with token auth, strips token from remote URL
 * - Subsequent calls: fetch all + checkout branch
 *
 * @param onLog - Optional callback for progress lines (e.g. streaming to terminal)
 */
export async function ensureRepoReady(
  connection: GheConnection,
  repo: WatchedRepo,
  branch: string,
  token: string,
  onLog?: (line: string) => void
): Promise<string> {
  const basePath = await getCheckoutBasePath();
  const repoPath = getRepoPath(
    basePath,
    connection.hostname,
    repo.owner,
    repo.name
  );
  const gitDir = path.join(repoPath, ".git");

  // Shared progress reporter — eliminates duplication between fetch and clone paths
  const progressCallback: SimpleGitOptions["progress"] = ({ method, stage, progress: pct }) => {
    onLog?.(`  git ${method}: ${stage} ${pct}%`);
  };

  // Kill git if it produces no output for 2 minutes (catches auth hangs, network stalls)
  const gitTimeout = { block: 120_000 };

  if (fs.existsSync(gitDir)) {
    // Existing clone — fetch latest + hard-reset to remote branch (equivalent to git pull)
    onLog?.(`Fetching latest changes for ${repo.owner}/${repo.name}...`);
    const git = simpleGit(repoPath, {
      progress: progressCallback,
      timeout: gitTimeout,
    });
    const authUrl = `https://${token}@${connection.hostname}/${repo.owner}/${repo.name}.git`;
    const cleanUrl = `https://${connection.hostname}/${repo.owner}/${repo.name}.git`;
    await git.remote(["set-url", "origin", authUrl]);
    try {
      await git.fetch(["--all"]);
    } finally {
      // Strip token from remote URL immediately regardless of success/failure
      await git.remote(["set-url", "origin", cleanUrl]);
    }
    onLog?.(`Fetch complete. Checking out branch: ${branch}`);
    await checkoutBranch(git, branch);
    onLog?.(`Branch "${branch}" is up to date.`);
  } else {
    // Fresh clone — use parent directory as explicit baseDir so the instance
    // is unambiguous (clone destination is still controlled by the cloneUrl + repoPath args)
    onLog?.(`Cloning ${repo.owner}/${repo.name} for the first time...`);
    const cloneUrl = `https://${token}@${connection.hostname}/${repo.owner}/${repo.name}.git`;
    fs.mkdirSync(repoPath, { recursive: true });
    const cloneGit = simpleGit(path.dirname(repoPath), {
      progress: progressCallback,
      timeout: gitTimeout,
    });
    await cloneGit.clone(cloneUrl, repoPath);
    onLog?.(`Clone complete. Removing token from remote URL...`);

    // Strip token from remote URL immediately to prevent credential leakage.
    const git = simpleGit(repoPath, { timeout: gitTimeout });
    const cleanUrl = `https://${connection.hostname}/${repo.owner}/${repo.name}.git`;
    try {
      await git.remote(["set-url", "origin", cleanUrl]);
      onLog?.(`Checking out branch: ${branch}`);
      await checkoutBranch(git, branch);
      onLog?.(`Branch "${branch}" is ready.`);
    } catch (err) {
      // Attempt to strip the token even if a later step failed — best effort
      try {
        await git.remote(["set-url", "origin", cleanUrl]);
      } catch {
        // Ignore secondary failure; rethrow original error below
      }
      throw err;
    }
  }

  return repoPath;
}
