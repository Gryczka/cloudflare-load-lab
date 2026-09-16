import { describe, expect, it } from "vitest";
import {
  allocateMetricInterval,
  emptyHistogram,
  emptyTotals,
  evaluateThresholds,
  histogramPercentile,
  missingSequenceCount,
  setGaugeContribution,
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

  it("uses the observed maximum when a percentile reaches the overflow bucket", () => {
    const histogram = emptyHistogram([10, 20, 50]);
    histogram.counts = [0, 0, 10];
    histogram.count = 10;
    histogram.max = 125;

    expect(histogramPercentile(histogram, 0.95)).toBe(125);
  });

  it("replaces gauge contributions from the same assignment", () => {
    const totals = emptyTotals();
    const contributions = {};

    setGaugeContribution(totals, contributions, "iad-1", {
      vus: 5,
      vusMax: 10,
    });
    setGaugeContribution(totals, contributions, "ams-1", {
      vus: 7,
      vusMax: 12,
    });
    setGaugeContribution(totals, contributions, "iad-1", {
      vus: 6,
      vusMax: 10,
    });

    expect(totals.vus).toBe(13);
    expect(totals.vusMax).toBe(22);
  });

  it("counts gaps between accepted metric sequences", () => {
    expect(missingSequenceCount(0, 1)).toBe(0);
    expect(missingSequenceCount(4, 7)).toBe(2);
    expect(missingSequenceCount(7, 7)).toBe(0);
  });

  it("allocates delayed counters by exact one-second overlap", () => {
    const allocations = allocateMetricInterval(
      "2026-09-03T12:00:02.200Z",
      "2026-09-03T12:00:00.200Z",
      "2026-09-03T12:00:00.000Z",
    );

    expect(allocations.map(({ timestamp }) => timestamp)).toEqual([
      "2026-09-03T12:00:00.000Z",
      "2026-09-03T12:00:01.000Z",
      "2026-09-03T12:00:02.000Z",
    ]);
    expect(allocations.map(({ fraction }) => fraction)).toEqual([
      0.4, 0.5, 0.1,
    ]);
    expect(allocations.at(-1)?.latest).toBe(true);
  });

  it("splits a sub-second catch-up without creating a rate spike", () => {
    const allocations = allocateMetricInterval(
      "2026-09-03T12:00:01.200Z",
      "2026-09-03T12:00:00.800Z",
      "2026-09-03T12:00:00.000Z",
    );

    expect(allocations.map(({ fraction }) => fraction)).toEqual([0.5, 0.5]);
    expect(
      allocations.reduce((sum, allocation) => sum + allocation.fraction, 0),
    ).toBe(1);
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

  it("treats a zero error threshold as no failures allowed", () => {
    const totals = emptyTotals();
    totals.requests = 100;
    totals.latency.count = 100;
    totals.latency.counts[5] = 100;
    totals.latency.max = 180;

    expect(
      evaluateThresholds(totals, { p95Ms: 500, errorRate: 0 }).passed,
    ).toBe(true);
    totals.failedRequests = 1;
    expect(
      evaluateThresholds(totals, { p95Ms: 500, errorRate: 0 }).passed,
    ).toBe(false);
  });
});
