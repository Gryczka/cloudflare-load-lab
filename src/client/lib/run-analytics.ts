import type { RunSnapshot, TimeSeriesPoint } from "../../shared/api";
import { histogramPercentile } from "../../shared/metrics";
import type { RunConfig } from "../../shared/types";

export interface RunAnalyticsSummary {
  durationSeconds: number;
  averageRps: number;
  peakRps: number;
  successRate: number;
  checkPassRate: number;
  dropRate: number;
  averageLatencyMs: number;
  p50Ms: number;
  p75Ms: number;
  p90Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxLatencyMs: number;
  transferredBytes: number;
  averageBytesPerSecond: number;
  latencyCoverage: number;
  retainedBuckets: number;
}

export interface LatencyDistributionBucket {
  label: string;
  count: number;
  percentage: number;
}

export function summarizeRun(run: RunSnapshot): RunAnalyticsSummary {
  const startedAt = run.startedAt ? Date.parse(run.startedAt) : Number.NaN;
  const completedAt = run.completedAt
    ? Date.parse(run.completedAt)
    : Date.parse(run.timeSeries.at(-1)?.timestamp ?? "");
  const durationSeconds =
    Number.isFinite(startedAt) && Number.isFinite(completedAt)
      ? Math.max(0, (completedAt - startedAt) / 1_000)
      : 0;
  const attempts = run.totals.iterations + run.totals.droppedIterations;
  const transferredBytes = run.totals.dataSent + run.totals.dataReceived;
  const retainedPeakRps = Math.max(
    0,
    ...bucketRateSeries(
      run.timeSeries,
      (point) => point.requests,
      (point) => point.requestsPerSecond,
    ).map(([, value]) => value),
  );

  return {
    durationSeconds,
    averageRps: durationSeconds > 0 ? run.totals.requests / durationSeconds : 0,
    peakRps: Math.max(run.peakRequestsPerSecond ?? 0, retainedPeakRps),
    successRate:
      run.totals.requests > 0
        ? 1 - run.totals.failedRequests / run.totals.requests
        : 0,
    checkPassRate:
      run.totals.checks > 0
        ? 1 - run.totals.failedChecks / run.totals.checks
        : 0,
    dropRate: attempts > 0 ? run.totals.droppedIterations / attempts : 0,
    averageLatencyMs:
      run.totals.latency.count > 0
        ? run.totals.latency.sum / run.totals.latency.count
        : 0,
    p50Ms: histogramPercentile(run.totals.latency, 0.5),
    p75Ms: histogramPercentile(run.totals.latency, 0.75),
    p90Ms: histogramPercentile(run.totals.latency, 0.9),
    p95Ms: histogramPercentile(run.totals.latency, 0.95),
    p99Ms: histogramPercentile(run.totals.latency, 0.99),
    maxLatencyMs: run.totals.latency.max,
    transferredBytes,
    averageBytesPerSecond:
      durationSeconds > 0 ? transferredBytes / durationSeconds : 0,
    latencyCoverage:
      run.totals.requests > 0
        ? run.totals.latency.count / run.totals.requests
        : 0,
    retainedBuckets: run.timeSeries.length,
  };
}

export function plannedTargetAt(
  config: RunConfig,
  elapsedSeconds: number,
): number {
  let previousTarget = config.profile.initialTarget;
  let stageStart = 0;

  for (const stage of config.profile.stages) {
    const stageEnd = stageStart + stage.durationSeconds;
    if (elapsedSeconds <= stageEnd) {
      const progress = Math.max(
        0,
        Math.min(1, (elapsedSeconds - stageStart) / stage.durationSeconds),
      );
      return previousTarget + (stage.target - previousTarget) * progress;
    }
    stageStart = stageEnd;
    previousTarget = stage.target;
  }

  return 0;
}

export function latencyDistribution(
  run: RunSnapshot,
): LatencyDistributionBucket[] {
  const total = run.totals.latency.count;
  return run.totals.latency.bounds.map((bound, index, bounds) => ({
    label: latencyBucketLabel(
      bounds[index - 1],
      bound,
      index === bounds.length - 1,
    ),
    count: run.totals.latency.counts[index] ?? 0,
    percentage:
      total > 0 ? ((run.totals.latency.counts[index] ?? 0) / total) * 100 : 0,
  }));
}

export function cumulativeErrorBudget(run: RunSnapshot): [number, number][] {
  const retainedRequests = run.timeSeries.reduce(
    (sum, point) => sum + point.requests,
    0,
  );
  const retainedFailures = run.timeSeries.reduce(
    (sum, point) => sum + point.failedRequests,
    0,
  );
  let requests = Math.max(0, run.totals.requests - retainedRequests);
  let failures = Math.max(0, run.totals.failedRequests - retainedFailures);

  return run.timeSeries.map((point) => {
    requests += point.requests;
    failures += point.failedRequests;
    const observedRate = requests > 0 ? failures / requests : 0;
    const budgetUsed =
      run.config.thresholds.errorRate === 0
        ? observedRate === 0
          ? 0
          : 200
        : (observedRate / run.config.thresholds.errorRate) * 100;
    return [new Date(point.timestamp).getTime(), budgetUsed];
  });
}

export function bucketRateSeries(
  points: TimeSeriesPoint[],
  value: (point: TimeSeriesPoint) => number,
  capturedRate?: (point: TimeSeriesPoint) => number | undefined,
): [number, number][] {
  let previousTimestamp: number | undefined;
  return points.map((point) => {
    const timestamp = new Date(point.timestamp).getTime();
    const elapsedSeconds =
      previousTimestamp === undefined
        ? 1
        : Math.max(1, (timestamp - previousTimestamp) / 1_000);
    previousTimestamp = timestamp;
    const rate = capturedRate?.(point);
    return [
      timestamp,
      rate !== undefined && Number.isFinite(rate)
        ? rate
        : value(point) / elapsedSeconds,
    ];
  });
}

function latencyBucketLabel(
  previous: number | undefined,
  bound: number,
  overflow: boolean,
): string {
  if (overflow) return `${formatLatency(previous ?? 0)}+`;
  if (previous === undefined) return `0-${formatLatency(bound)}`;
  return `${formatLatency(previous)}-${formatLatency(bound)}`;
}

function formatLatency(value: number): string {
  if (value >= 1_000) return `${value / 1_000}s`;
  return `${value}ms`;
}
