import { describe, expect, it } from "vitest";
import { resolveBuiltInTarget } from "./target-policy";

describe("resolveBuiltInTarget", () => {
  it("allows an authenticated custom plan to use the owned target", () => {
    expect(
      resolveBuiltInTarget("demo", "https://cloudflare-load-lab.example.com"),
    ).toBe("https://cloudflare-load-lab.example.com");
  });

  it("leaves verified target IDs for database resolution", () => {
    expect(
      resolveBuiltInTarget(
        "verified-target-id",
        "https://cloudflare-load-lab.example.com",
      ),
    ).toBeUndefined();
  });
});
