import { describe, expect, it } from "vitest";
import { SAMPLE_RUN } from "./sample";
import {
  bucketRateSeries,
  cumulativeErrorBudget,
  latencyDistribution,
  plannedTargetAt,
  summarizeRun,
} from "./run-analytics";

describe("run analytics", () => {
  it("summarizes a completed run", () => {
    const summary = summarizeRun(SAMPLE_RUN);

    expect(summary.durationSeconds).toBe(20);
    expect(summary.averageRps).toBeCloseTo(SAMPLE_RUN.totals.requests / 20);
    expect(summary.peakRps).toBe(15);
    expect(summary.p95Ms).toBe(300);
    expect(summary.transferredBytes).toBe(
      SAMPLE_RUN.totals.dataSent + SAMPLE_RUN.totals.dataReceived,
    );
    expect(summary.retainedBuckets).toBe(20);
    expect(SAMPLE_RUN.totals.vusMax).toBe(
      Math.max(...SAMPLE_RUN.timeSeries.map((point) => point.vusMax ?? 0)),
    );
  });

  it("interpolates every configured ramp stage", () => {
    expect(plannedTargetAt(SAMPLE_RUN.config, 0)).toBe(3);
    expect(plannedTargetAt(SAMPLE_RUN.config, 2.5)).toBe(4.5);
    expect(plannedTargetAt(SAMPLE_RUN.config, 5)).toBe(6);
    expect(plannedTargetAt(SAMPLE_RUN.config, 10)).toBe(10.5);
    expect(plannedTargetAt(SAMPLE_RUN.config, 15)).toBe(15);
    expect(plannedTargetAt(SAMPLE_RUN.config, 17.5)).toBe(9);
    expect(plannedTargetAt(SAMPLE_RUN.config, 20)).toBe(3);
    expect(plannedTargetAt(SAMPLE_RUN.config, 20.1)).toBe(0);
  });

  it("builds mutually exclusive latency buckets", () => {
    const distribution = latencyDistribution(SAMPLE_RUN);

    expect(distribution[0]?.label).toBe("0-5ms");
    expect(distribution.at(-1)?.label).toBe("30s+");
    expect(distribution.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(
      SAMPLE_RUN.totals.latency.count,
    );
    expect(
      distribution.reduce((sum, bucket) => sum + bucket.percentage, 0),
    ).toBeCloseTo(100);
  });

  it("reports cumulative error-budget consumption", () => {
    const budget = cumulativeErrorBudget(SAMPLE_RUN);

    expect(budget[11]?.[1]).toBe(0);
    expect(budget[12]?.[1]).toBeGreaterThan(budget.at(-1)?.[1] ?? 0);
    expect(budget.at(-1)?.[1]).toBeCloseTo(
      (SAMPLE_RUN.totals.failedRequests /
        SAMPLE_RUN.totals.requests /
        SAMPLE_RUN.config.thresholds.errorRate) *
        100,
    );
  });

  it("normalizes counters across missing time buckets", () => {
    const points = [
      SAMPLE_RUN.timeSeries[0]!,
      { ...SAMPLE_RUN.timeSeries[1]!, timestamp: "2026-09-03T12:00:03.000Z" },
    ];

    expect(bucketRateSeries(points, (point) => point.requests)).toEqual([
      [Date.parse(points[0]!.timestamp), 3],
      [Date.parse(points[1]!.timestamp), 4 / 3],
    ]);
  });

  it("prefers coordinator-provided cross-shard rates", () => {
    const points = [
      {
        ...SAMPLE_RUN.timeSeries[0]!,
        requestsPerSecond: 9.5,
      },
    ];

    expect(
      bucketRateSeries(
        points,
        (point) => point.requests,
        (point) => point.requestsPerSecond,
      )[0]?.[1],
    ).toBe(9.5);
  });

  it("anchors retained-window error budget to run-wide totals", () => {
    const retainedTail = {
      ...SAMPLE_RUN,
      timeSeries: SAMPLE_RUN.timeSeries.slice(-2),
    };
    const budget = cumulativeErrorBudget(retainedTail);

    expect(budget.at(-1)?.[1]).toBeCloseTo(
      (SAMPLE_RUN.totals.failedRequests /
        SAMPLE_RUN.totals.requests /
        SAMPLE_RUN.config.thresholds.errorRate) *
        100,
    );
  });
});
