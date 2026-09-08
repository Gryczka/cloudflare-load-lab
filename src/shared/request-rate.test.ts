import { describe, expect, it } from "vitest";
import {
  REQUEST_RATE_FRESHNESS_MS,
  normalizeBatchRequestRate,
  visibleRequestRate,
} from "./request-rate";

const NOW = Date.parse("2026-09-03T18:00:10.000Z");

describe("normalizeBatchRequestRate", () => {
  it("normalizes delayed metric deltas to requests per second", () => {
    expect(
      normalizeBatchRequestRate(
        150,
        "2026-09-03T18:00:03.000Z",
        "2026-09-03T18:00:01.000Z",
      ),
    ).toBe(75);
    expect(normalizeBatchRequestRate(18, "2026-09-03T18:00:01.000Z")).toBe(18);
  });
});

describe("visibleRequestRate", () => {
  it("returns a fresh one-second batch while a generator is running", () => {
    expect(
      visibleRequestRate(
        "running",
        82,
        new Date(NOW - 1_000).toISOString(),
        NOW,
      ),
    ).toBe(82);
  });

  it("stops stale and completed nodes from appearing active", () => {
    const stale = new Date(NOW - REQUEST_RATE_FRESHNESS_MS - 1).toISOString();
    expect(visibleRequestRate("running", 82, stale, NOW)).toBe(0);
    expect(
      visibleRequestRate(
        "complete",
        82,
        new Date(NOW - 1_000).toISOString(),
        NOW,
      ),
    ).toBe(0);
  });
});
