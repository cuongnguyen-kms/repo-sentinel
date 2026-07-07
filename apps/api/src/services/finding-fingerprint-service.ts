/**
 * Content-based fingerprints for cross-review finding matching.
 *
 * AI-generated IDs (F1, F2, …) reset each review run, so they cannot be
 * used to compare findings across runs. This service hashes
 * file + severity + normalised title into a stable 12-char hex fingerprint.
 */

import { createHash } from "node:crypto";
import type { CodeReviewFinding } from "@repo-sentinel/types";

/** Hash file:severity:normalizedTitle → 12-char hex. */
export function hashFingerprint(file: string, severity: string, title: string): string {
  const normalized = title.toLowerCase().replace(/\s+/g, " ").trim();
  return createHash("sha256")
    .update(`${file}:${severity}:${normalized}`)
    .digest("hex")
    .slice(0, 12);
}

/**
 * Enrich each finding with a content-based fingerprint.
 * Deduplicates within-review by appending `-2`, `-3`, etc.
 * Sorted by base hash before suffix assignment so ordering is stable across runs.
 */
export function computeFingerprints(findings: CodeReviewFinding[]): void {
  const indexed = findings.map((f, i) => ({
    f, i, base: hashFingerprint(f.file, f.severity, f.title),
  }));
  // Sort by base hash so duplicate suffix assignment is order-independent
  indexed.sort((a, b) => a.base.localeCompare(b.base));

  const seen = new Map<string, number>();
  for (const { f, base } of indexed) {
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    f.fingerprint = count > 1 ? `${base}-${count}` : base;
  }
}
