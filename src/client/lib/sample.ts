import type { RunSnapshot } from "../../shared/api";
import { emptyTotals, LATENCY_BOUNDS_MS } from "../../shared/metrics";
import { DEMO_RUN_CONFIG } from "../../shared/types";

const started = new Date("2026-09-03T12:00:00.000Z");
const requestSeries = [
  3, 4, 6, 7, 8, 11, 13, 15, 15, 15, 15, 14, 15, 15, 14, 11, 8, 6, 4, 3,
];
const latencySeries = [
  128, 132, 141, 148, 156, 164, 177, 188, 201, 214, 228, 219, 211, 205, 196,
  181, 168, 154, 146, 137,
];

const totals = emptyTotals();
totals.requests = requestSeries.reduce((sum, value) => sum + value, 0);
totals.failedRequests = 1;
totals.iterations = totals.requests;
totals.checks = totals.requests;
totals.failedChecks = 1;
totals.dataReceived = totals.requests * 2_180;
totals.dataSent = totals.requests * 460;
totals.vus = 0;
totals.vusMax = 24;
totals.latency = {
  bounds: [...LATENCY_BOUNDS_MS],
  counts: [0, 0, 0, 0, 32, totals.requests - 34, 2, 0, 0, 0, 0, 0, 0, 0, 0],
  count: totals.requests,
  sum: totals.requests * 174,
  max: 312,
};

export const SAMPLE_RUN: RunSnapshot = {
  id: "sample-global-pulse",
  status: "passed",
  config: { ...DEMO_RUN_CONFIG, name: "Checkout API · release/2026.09" },
  isDemo: true,
  createdAt: started.toISOString(),
  startedAt: started.toISOString(),
  completedAt: new Date(started.getTime() + 20_000).toISOString(),
  assignments: [
    {
      region: "ENAM",
      shard: 0,
      weight: 34,
      profile: DEMO_RUN_CONFIG.profile,
      id: "sample-enam",
      status: "complete",
      lastSequence: 20,
      lastHeartbeat: new Date(started.getTime() + 20_000).toISOString(),
      placement: {
        requestedRegion: "ENAM",
        actualRegion: "ENAM",
        location: "iad",
        country: "US",
      },
    },
    {
      region: "WEUR",
      shard: 0,
      weight: 33,
      profile: DEMO_RUN_CONFIG.profile,
      id: "sample-weur",
      status: "complete",
      lastSequence: 20,
      lastHeartbeat: new Date(started.getTime() + 20_000).toISOString(),
      placement: {
        requestedRegion: "WEUR",
        actualRegion: "WEUR",
        location: "ams",
        country: "NL",
      },
    },
    {
      region: "APAC",
      shard: 0,
      weight: 33,
      profile: DEMO_RUN_CONFIG.profile,
      id: "sample-apac",
      status: "complete",
      lastSequence: 20,
      lastHeartbeat: new Date(started.getTime() + 20_000).toISOString(),
      placement: {
        requestedRegion: "APAC",
        actualRegion: "APAC",
        location: "sin",
        country: "SG",
      },
    },
  ],
  totals,
  thresholds: {
    passed: true,
    p95Ms: 300,
    errorRate: 1 / totals.requests,
    checks: { latency: true, errors: true },
  },
  timeSeries: requestSeries.map((requests, index) => ({
    timestamp: new Date(started.getTime() + index * 1_000).toISOString(),
    requests,
    failedRequests: index === 12 ? 1 : 0,
    vus: Math.max(3, Math.round(requests * 1.45)),
    p95Ms: latencySeries[index] ?? 0,
  })),
  events: [
    {
      at: started.toISOString(),
      type: "queued",
      message: "Reserved 3 generator shards",
    },
    {
      at: new Date(started.getTime() + 1_100).toISOString(),
      type: "ready",
      message: "All regional Containers reported ready",
    },
    {
      at: new Date(started.getTime() + 3_000).toISOString(),
      type: "running",
      message: "Generators crossed the synchronized start barrier",
    },
    {
      at: new Date(started.getTime() + 20_000).toISOString(),
      type: "passed",
      message: "All global thresholds passed",
    },
  ],
  reportReady: true,
};
