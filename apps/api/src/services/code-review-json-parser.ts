/**
 * Reads and validates the code-review-result.json file written by Claude CLI.
 * Returns null on any failure (missing file, malformed JSON, validation error)
 * so that the review pipeline never fails due to JSON issues.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CodeReviewResult, CodeReviewFinding, FindingSeverity } from "@repo-sentinel/types";

const JSON_FILENAME = "code-review-result.json";
const MAX_JSON_SIZE_BYTES = 512_000; // 500KB safety limit

const VALID_SEVERITIES: Set<string> = new Set(["critical", "high", "medium", "low", "info"]);

/**
 * Validate a single finding object has required fields with correct types.
 */
function isValidFinding(f: unknown): f is CodeReviewFinding {
  if (typeof f !== "object" || f === null) return false;
  const obj = f as Record<string, unknown>;
  return (
    typeof obj.id === "string" &&
    typeof obj.severity === "string" &&
    VALID_SEVERITIES.has(obj.severity) &&
    typeof obj.title === "string" &&
    typeof obj.file === "string" &&
    typeof obj.line === "number" &&
    typeof obj.comment === "string"
  );
}

/**
 * Normalize a parsed JSON object into a valid CodeReviewResult.
 * Applies defaults for missing optional fields and filters invalid findings.
 */
function normalizeResult(raw: Record<string, unknown>): CodeReviewResult | null {
  const score = typeof raw.score === "number" ? raw.score : null;
  if (score === null || score < 0 || score > 10) return null;

  const summary = typeof raw.summary === "string" ? raw.summary : "";
  const rawFindings = Array.isArray(raw.findings) ? raw.findings : [];
  const findings = rawFindings.filter(isValidFinding).map((f) => ({
    ...f,
    severity: f.severity as FindingSeverity,
    endLine: typeof f.endLine === "number" ? f.endLine : undefined,
    suggestion: typeof f.suggestion === "string" ? f.suggestion : undefined,
    codeContext: typeof f.codeContext === "string" ? f.codeContext : undefined,
  }));

  // Recompute stats from actual findings for accuracy
  const stats = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) {
    const sev = f.severity as keyof typeof stats;
    if (sev in stats) stats[sev]++;
    else stats.info++;
  }

  return { score, summary, findings, stats };
}

/**
 * Read code-review-result.json from the cloned repo directory.
 * Returns parsed + validated CodeReviewResult, or null on any failure.
 *
 * @param repoPath - absolute path to the cloned repo directory
 * @param log - optional logger for warnings
 */
export async function readCodeReviewJson(
  repoPath: string,
  log?: {
    warn: (obj: Record<string, unknown>, msg: string) => void;
    info?: (obj: Record<string, unknown>, msg: string) => void;
  }
): Promise<CodeReviewResult | null> {
  const filePath = join(repoPath, JSON_FILENAME);

  try {
    const raw = await readFile(filePath, "utf-8");

    if (raw.length > MAX_JSON_SIZE_BYTES) {
      log?.warn({ size: raw.length, limit: MAX_JSON_SIZE_BYTES }, "code-review-result.json exceeds size limit");
      return null;
    }

    // Strip BOM and leading/trailing whitespace
    const cleaned = raw.replace(/^﻿/, "").trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      log?.warn(
        { error: parseErr instanceof Error ? parseErr.message : String(parseErr), first200: cleaned.substring(0, 200) },
        "code-review-result.json has invalid JSON"
      );
      return null;
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      log?.warn({ type: typeof parsed }, "code-review-result.json is not a JSON object");
      return null;
    }

    const result = normalizeResult(parsed as Record<string, unknown>);
    if (!result) {
      const p = parsed as Record<string, unknown>;
      log?.warn({ score: p.score, scoreType: typeof p.score }, "code-review-result.json failed validation");
      return null;
    }

    log?.info?.({}, `Parsed ${result.findings.length} findings from code-review-result.json`);
    return result;
  } catch (err) {
    // ENOENT = file not found — Claude didn't write it. Not an error.
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      log?.warn({}, "code-review-result.json not found — Claude may not have written it");
    } else {
      log?.warn(
        { error: err instanceof Error ? err.message : String(err) },
        "Failed to read/parse code-review-result.json"
      );
    }
    return null;
  }
}
