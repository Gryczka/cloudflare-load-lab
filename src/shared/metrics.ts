import type { RegionCode } from "./types";

export const LATENCY_BOUNDS_MS = [
  5, 10, 25, 50, 100, 200, 300, 500, 750, 1_000, 2_000, 5_000, 10_000, 30_000,
  60_000,
] as const;

export interface LatencyHistogram {
  bounds: number[];
  counts: number[];
  count: number;
  sum: number;
  max: number;
}

export interface GeneratorPlacement {
  requestedRegion: RegionCode;
  actualRegion?: string;
  location?: string;
  country?: string;
}

export interface MetricBatch {
  runId: string;
  assignmentId: string;
  sequence: number;
  timestamp: string;
  placement: GeneratorPlacement;
  requests: number;
  failedRequests: number;
  checks: number;
  failedChecks: number;
  iterations: number;
  droppedIterations: number;
  dataSent: number;
  dataReceived: number;
  vus: number;
  vusMax: number;
  latency: LatencyHistogram;
  errors: Record<string, number>;
}

export interface MetricTotals {
  requests: number;
  failedRequests: number;
  checks: number;
  failedChecks: number;
  iterations: number;
  droppedIterations: number;
  dataSent: number;
  dataReceived: number;
  vus: number;
  vusMax: number;
  latency: LatencyHistogram;
  errors: Record<string, number>;
}

export interface ThresholdResult {
  passed: boolean;
  p95Ms: number;
  errorRate: number;
  checks: {
    latency: boolean;
    errors: boolean;
  };
}

export function emptyHistogram(
  bounds: readonly number[] = LATENCY_BOUNDS_MS,
): LatencyHistogram {
  return {
    bounds: [...bounds],
    counts: bounds.map(() => 0),
    count: 0,
    sum: 0,
    max: 0,
  };
}

export function emptyTotals(): MetricTotals {
  return {
    requests: 0,
    failedRequests: 0,
    checks: 0,
    failedChecks: 0,
    iterations: 0,
    droppedIterations: 0,
    dataSent: 0,
    dataReceived: 0,
    vus: 0,
    vusMax: 0,
    latency: emptyHistogram(),
    errors: {},
  };
}

export function mergeHistogram(
  target: LatencyHistogram,
  source: LatencyHistogram,
): void {
  if (
    target.bounds.length !== source.bounds.length ||
    target.bounds.some((bound, index) => bound !== source.bounds[index])
  ) {
    throw new Error("Cannot merge histograms with different bounds");
  }
  source.counts.forEach((count, index) => {
    target.counts[index] = (target.counts[index] ?? 0) + count;
  });
  target.count += source.count;
  target.sum += source.sum;
  target.max = Math.max(target.max, source.max);
}

export function addBatch(
  target: MetricTotals,
  batch: MetricBatch,
): MetricTotals {
  target.requests += batch.requests;
  target.failedRequests += batch.failedRequests;
  target.checks += batch.checks;
  target.failedChecks += batch.failedChecks;
  target.iterations += batch.iterations;
  target.droppedIterations += batch.droppedIterations;
  target.dataSent += batch.dataSent;
  target.dataReceived += batch.dataReceived;
  target.vus += batch.vus;
  target.vusMax += batch.vusMax;
  mergeHistogram(target.latency, batch.latency);
  for (const [message, count] of Object.entries(batch.errors)) {
    target.errors[message] = (target.errors[message] ?? 0) + count;
  }
  return target;
}

/** Returns the histogram bucket's upper bound. This is deterministic and conservative. */
export function histogramPercentile(
  histogram: LatencyHistogram,
  percentile: number,
): number {
  if (histogram.count === 0) return 0;
  const wanted = Math.max(1, Math.ceil(histogram.count * percentile));
  let seen = 0;
  for (let index = 0; index < histogram.counts.length; index += 1) {
    seen += histogram.counts[index] ?? 0;
    if (seen >= wanted) return histogram.bounds[index] ?? histogram.max;
  }
  return histogram.max;
}

export function evaluateThresholds(
  totals: MetricTotals,
  thresholds: { p95Ms: number; errorRate: number },
): ThresholdResult {
  const p95Ms = histogramPercentile(totals.latency, 0.95);
  const errorRate =
    totals.requests === 0 ? 0 : totals.failedRequests / totals.requests;
  const latency = totals.requests > 0 && p95Ms < thresholds.p95Ms;
  const errors = totals.requests > 0 && errorRate < thresholds.errorRate;
  return {
    passed: latency && errors,
    p95Ms,
    errorRate,
    checks: { latency, errors },
  };
}
