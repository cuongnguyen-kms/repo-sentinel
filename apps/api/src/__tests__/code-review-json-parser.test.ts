import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { readCodeReviewJson } from "../services/code-review-json-parser.js";

describe("code-review-json-parser", () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("accepts mismatch_requirement and checklist_required findings and counts them in stats", async () => {
    dir = await mkdtemp(join(tmpdir(), "code-review-json-"));
    await writeFile(
      join(dir, "code-review-result.json"),
      JSON.stringify({
        score: 8,
        summary: "Looks good overall",
        findings: [
          {
            id: "F1",
            severity: "mismatch_requirement",
            title: "Contradicts ticket",
            file: "src/a.ts",
            line: 10,
            comment: "Ticket says 404, code returns 200",
          },
          {
            id: "F2",
            severity: "checklist_required",
            title: "Missing requirement",
            file: "src/b.ts",
            line: 20,
            comment: "Checklist item not addressed anywhere in the diff",
          },
        ],
        stats: { critical: 0, high: 0, medium: 0, low: 0, info: 0, mismatch_requirement: 1, checklist_required: 1 },
      })
    );

    const result = await readCodeReviewJson(dir);
    expect(result).not.toBeNull();
    expect(result!.findings).toHaveLength(2);
    expect(result!.findings.map((f) => f.severity)).toEqual(["mismatch_requirement", "checklist_required"]);
    expect(result!.stats.mismatch_requirement).toBe(1);
    expect(result!.stats.checklist_required).toBe(1);
  });

  it("rejects findings with an unknown severity", async () => {
    dir = await mkdtemp(join(tmpdir(), "code-review-json-"));
    await writeFile(
      join(dir, "code-review-result.json"),
      JSON.stringify({
        score: 8,
        summary: "x",
        findings: [{ id: "F1", severity: "not_a_real_severity", title: "t", file: "a.ts", line: 1, comment: "c" }],
        stats: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      })
    );

    const result = await readCodeReviewJson(dir);
    expect(result?.findings).toHaveLength(0);
  });
});
