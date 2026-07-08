import { describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", () => ({
  default: {
    resolve4: vi.fn().mockRejectedValue(new Error("ENOTFOUND")),
    resolve6: vi.fn().mockRejectedValue(new Error("ENOTFOUND")),
  },
}));

import { validateAtlassianHostname, validateHostname } from "../utils/hostname-validation.js";

describe("validateAtlassianHostname", () => {
  it("rejects non-atlassian.net hostnames", async () => {
    await expect(validateAtlassianHostname("example.com")).rejects.toThrow(/Atlassian Cloud/);
  });

  it("rejects private/loopback IP literals even with the right suffix spoofed", () => {
    expect(() => validateHostname("localhost")).toThrow();
  });

  it("fails closed for a hostname that does not resolve (mocked DNS)", async () => {
    await expect(validateAtlassianHostname("this-does-not-exist-repo-sentinel-test.atlassian.net"))
      .rejects.toThrow(/could not be resolved/);
  });
});
