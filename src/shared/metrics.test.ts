import { describe, expect, it } from "vitest";
import {
  emptyHistogram,
  emptyTotals,
  evaluateThresholds,
  histogramPercentile,
} from "./metrics";

describe("histogram aggregation", () => {
  it("returns a conservative percentile bound", () => {
    const histogram = emptyHistogram([10, 20, 50]);
    histogram.counts = [2, 6, 2];
    histogram.count = 10;
    histogram.max = 45;
    expect(histogramPercentile(histogram, 0.5)).toBe(20);
    expect(histogramPercentile(histogram, 0.95)).toBe(50);
  });

  it("requires traffic for a passing threshold", () => {
    expect(
      evaluateThresholds(emptyTotals(), { p95Ms: 500, errorRate: 0.01 }).passed,
    ).toBe(false);
  });

  it("evaluates latency and errors together", () => {
    const totals = emptyTotals();
    totals.requests = 100;
    totals.failedRequests = 0;
    totals.latency.count = 100;
    totals.latency.counts[5] = 100;
    totals.latency.max = 180;
    expect(
      evaluateThresholds(totals, { p95Ms: 500, errorRate: 0.01 }).passed,
    ).toBe(true);
  });
});
