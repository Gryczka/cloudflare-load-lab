import { DurableObject } from "cloudflare:workers";
import type {
  AgentCompletePayload,
  AgentPrepareRequest,
  AssignmentState,
  RunEvent,
  RunSnapshot,
  TimeSeriesPoint,
} from "../../shared/api";
import {
  allocateMetricInterval,
  addBatch,
  emptyTotals,
  evaluateThresholds,
  histogramPercentile,
  missingSequenceCount,
  setGaugeContribution,
  type GaugeValues,
  type MetricBatch,
  type MetricTotals,
} from "../../shared/metrics";
import { planAssignments } from "../../shared/planner";
import {
  normalizeBatchRequestRate,
  visibleRequestRate,
} from "../../shared/request-rate";
import {
  REGIONS,
  TERMINAL_STATUSES,
  runConfigSchema,
  runDurationSeconds,
  type RegionCode,
  type RunConfig,
  type RunStatus,
} from "../../shared/types";
import type { Env } from "../env";

interface InternalAssignment extends AssignmentState {
  latestVus: number;
  latestVusMax: number;
  acceptedBatches: number;
  missingSequences: number;
  metricBatchAt?: string;
  requestRateAt?: string;
}

interface StoredMetricBucket {
  totals: MetricTotals;
  gauges: Record<string, GaugeValues>;
  rates: StoredMetricRates;
  latencyContributors: Record<string, true>;
}

interface StoredMetricRates {
  requests: number;
  failedRequests: number;
  checks: number;
  failedChecks: number;
  iterations: number;
  droppedIterations: number;
  dataSent: number;
  dataReceived: number;
}

interface StoredRun {
  id: string;
  status: RunStatus;
  config: RunConfig;
  targetOrigin: string;
  callbackBaseUrl: string;
  isDemo: boolean;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  assignments: InternalAssignment[];
  totals: MetricTotals;
  peakRequestsPerSecond: number;
  buckets: Record<string, MetricTotals | StoredMetricBucket>;
  events: RunEvent[];
  error?: string;
  reportReady: boolean;
}

export class RunCoordinator extends DurableObject<Env> {
  private run?: StoredRun;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.run = await ctx.storage.get<StoredRun>("run");
    });
  }

  async initialize(input: {
    id: string;
    config: RunConfig;
    targetOrigin: string;
    callbackBaseUrl: string;
    isDemo: boolean;
  }): Promise<RunSnapshot> {
    if (this.run) {
      if (this.run.id !== input.id)
        throw new Error("Coordinator already belongs to another run");
      return this.snapshot();
    }

    const config = runConfigSchema.parse(input.config);
    const assignments: InternalAssignment[] = planAssignments(config).map(
      (plan, index) => ({
        ...plan,
        id: `${input.id}-${plan.region.toLowerCase()}-${index}`,
        token: crypto.randomUUID(),
        status: "pending",
        requestRate: 0,
        lastSequence: 0,
        acceptedBatches: 0,
        missingSequences: 0,
        latestVus: 0,
        latestVusMax: 0,
      }),
    );
    this.run = {
      id: input.id,
      status: "queued",
      config,
      targetOrigin: input.targetOrigin,
      callbackBaseUrl: input.callbackBaseUrl.replace(/\/$/, ""),
      isDemo: input.isDemo,
      createdAt: new Date().toISOString(),
      assignments,
      totals: emptyTotals(),
      peakRequestsPerSecond: 0,
      buckets: {},
      events: [],
      reportReady: false,
    };
    this.event(
      "queued",
      `Reserved ${assignments.length} generator shard${assignments.length === 1 ? "" : "s"}`,
    );
    await this.persist();
    // Use an alarm so orchestration is not bounded by the API request's waitUntil
    // lifetime. The execution deadline replaces this alarm after startup.
    await this.ctx.storage.setAlarm(Date.now() + 100);
    return this.snapshot();
  }

  async launch(): Promise<void> {
    const run = this.requireRun();
    if (run.status !== "queued") return;
    run.status = "starting";
    this.event("starting", "Warming regional Containers");
    await this.updateIndex();
    await this.persist();

    try {
      await inBatches(run.assignments, 6, async (assignment) => {
        const stub = this.generator(assignment.region, assignment.id);
        const request: AgentPrepareRequest = {
          runId: run.id,
          assignmentId: assignment.id,
          callbackUrl: run.callbackBaseUrl,
          callbackToken: assignment.token,
          targetOrigin: run.targetOrigin,
          tasks: run.config.tasks,
          profile: assignment.profile,
          requestedRegion: assignment.region,
        };
        const response = await stub.prepare(request);
        assignment.status = "ready";
        assignment.placement = response.placement;
        assignment.lastHeartbeat = new Date().toISOString();
        this.event(
          "ready",
          `${assignment.region} shard ready${response.placement.location ? ` in ${response.placement.location}` : ""}`,
        );
        await this.persist();
      });

      const startAt = new Date(Date.now() + 3_000).toISOString();
      await inBatches(run.assignments, 6, async (assignment) => {
        await this.generator(assignment.region, assignment.id).launch(startAt);
        assignment.status = "running";
      });
      run.status = "running";
      run.startedAt = startAt;
      this.event(
        "running",
        "All generator shards crossed the synchronized start barrier",
      );
      await this.ctx.storage.setAlarm(
        new Date(startAt).getTime() +
          (runDurationSeconds(run.config) + 30) * 1_000,
      );
      await this.updateIndex();
      await this.persist();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.stopGenerators();
      await this.finalize(
        "error",
        `Unable to launch every requested region: ${message}`,
      );
    }
  }

  async ingest(token: string, batch: MetricBatch): Promise<boolean> {
    const run = this.requireRun();
    const assignmentIndex = run.assignments.findIndex(
      (candidate) =>
        candidate.id === batch.assignmentId && candidate.token === token,
    );
    const assignment = run.assignments[assignmentIndex];
    if (!assignment || batch.runId !== run.id) {
      console.warn("Rejected metric identity", {
        runIdMatches: batch.runId === run.id,
        assignmentId: batch.assignmentId,
        assignmentExists: run.assignments.some(
          (candidate) => candidate.id === batch.assignmentId,
        ),
      });
      return false;
    }
    const receivedAt = new Date().toISOString();
    const previousBatchAt = assignment.metricBatchAt;
    if (
      !isValidBatch(batch) ||
      !isValidBatchTimestamp(
        batch.timestamp,
        previousBatchAt,
        run,
        receivedAt,
      ) ||
      batch.sequence <= assignment.lastSequence
    ) {
      console.warn("Rejected malformed or duplicate metric batch", {
        assignmentId: batch.assignmentId,
        sequence: batch.sequence,
        lastSequence: assignment.lastSequence,
      });
      return false;
    }

    const previousGauges = {
      vus: assignment.latestVus,
      vusMax: assignment.latestVusMax,
    };
    const allocations = allocateMetricInterval(
      batch.timestamp,
      previousBatchAt,
      run.startedAt ?? run.createdAt,
    );
    if (allocations.length === 0) return false;
    const primaryAllocation = allocations.reduce((primary, allocation) =>
      allocation.fraction > primary.fraction ? allocation : primary,
    );
    assignment.acceptedBatches = (assignment.acceptedBatches ?? 0) + 1;
    assignment.missingSequences =
      (assignment.missingSequences ?? 0) +
      missingSequenceCount(assignment.lastSequence, batch.sequence);
    assignment.lastSequence = batch.sequence;
    assignment.lastHeartbeat = receivedAt;
    assignment.requestRate = normalizeBatchRequestRate(
      batch.requests,
      batch.timestamp,
      previousBatchAt,
    );
    assignment.metricBatchAt = batch.timestamp;
    assignment.requestRateAt = receivedAt;
    assignment.placement = batch.placement;
    if (assignment.status === "ready") assignment.status = "running";

    // Counters are additive; VUs are gauges, so replace this assignment's latest value.
    run.totals.vus += batch.vus - assignment.latestVus;
    run.totals.vusMax += batch.vusMax - assignment.latestVusMax;
    assignment.latestVus = batch.vus;
    assignment.latestVusMax = batch.vusMax;
    addBatch(run.totals, { ...batch, vus: 0, vusMax: 0 });

    for (const allocation of allocations) {
      const coveredBucket = ensureMetricBucket(run, allocation.timestamp);
      addBatchRates(coveredBucket.rates, batch, allocation.fraction);
      run.peakRequestsPerSecond = Math.max(
        run.peakRequestsPerSecond ?? 0,
        coveredBucket.rates.requests,
      );
      setGaugeContribution(
        coveredBucket.totals,
        coveredBucket.gauges,
        String(assignmentIndex),
        allocation.latest
          ? { vus: batch.vus, vusMax: batch.vusMax }
          : previousGauges,
      );
    }
    const currentBucket = ensureMetricBucket(run, primaryAllocation.timestamp);
    addBatch(currentBucket.totals, { ...batch, vus: 0, vusMax: 0 });
    if (
      !previousBatchAt ||
      Date.parse(batch.timestamp) - Date.parse(previousBatchAt) <= 1_250
    ) {
      currentBucket.latencyContributors[String(assignmentIndex)] = true;
    }
    trimBuckets(run.buckets, 900);
    await this.persist();
    return true;
  }

  async complete(
    token: string,
    completion: AgentCompletePayload,
  ): Promise<boolean> {
    const run = this.requireRun();
    const assignment = run.assignments.find(
      (candidate) =>
        candidate.id === completion.assignmentId && candidate.token === token,
    );
    if (!assignment || completion.runId !== run.id) {
      console.warn("Rejected completion identity", {
        runIdMatches: completion.runId === run.id,
        assignmentId: completion.assignmentId,
        assignmentExists: run.assignments.some(
          (candidate) => candidate.id === completion.assignmentId,
        ),
      });
      return false;
    }

    assignment.status = completion.status;
    assignment.error = completion.error;
    assignment.lastHeartbeat = completion.completedAt;
    assignment.latestVus = 0;
    assignment.requestRate = 0;
    assignment.metricBatchAt = undefined;
    assignment.requestRateAt = undefined;
    run.totals.vus = run.assignments.reduce(
      (sum, item) => sum + item.latestVus,
      0,
    );
    this.event(
      completion.status,
      `${assignment.region} shard ${completion.status === "complete" ? "completed" : completion.status}`,
    );
    await this.persist();

    if (
      run.assignments.every((item) =>
        ["complete", "cancelled", "error"].includes(item.status),
      )
    ) {
      if (
        run.status === "stopping" ||
        run.assignments.some((item) => item.status === "cancelled")
      ) {
        await this.finalize("cancelled");
      } else if (run.assignments.some((item) => item.status === "error")) {
        await this.finalize("error", "One or more generator shards failed");
      } else {
        const thresholds = evaluateThresholds(
          run.totals,
          run.config.thresholds,
        );
        await this.finalize(thresholds.passed ? "passed" : "failed");
      }
    }
    return true;
  }

  async stopRun(): Promise<RunSnapshot> {
    const run = this.requireRun();
    if (TERMINAL_STATUSES.includes(run.status)) return this.snapshot();
    run.status = "stopping";
    this.event("stopping", "Cancellation requested; draining generators");
    await this.updateIndex();
    await this.persist();
    await this.stopGenerators();
    await this.finalize("cancelled");
    return this.snapshot();
  }

  async getSnapshot(): Promise<RunSnapshot> {
    return this.snapshot();
  }

  async alarm(): Promise<void> {
    const run = this.run;
    if (!run || TERMINAL_STATUSES.includes(run.status)) return;
    if (run.status === "queued") {
      await this.launch();
      return;
    }
    await this.stopGenerators();
    await this.finalize("error", "Run exceeded its execution deadline");
  }

  private async finalize(status: RunStatus, error?: string): Promise<void> {
    const run = this.requireRun();
    if (TERMINAL_STATUSES.includes(run.status) && run.completedAt) return;
    run.status = status;
    run.completedAt = new Date().toISOString();
    run.error = error;
    run.totals.vus = 0;
    this.event(status, finalMessage(status));
    run.config = redactConfig(run.config);
    await this.persist();

    const snapshot = this.snapshot();
    try {
      await this.env.LOADLAB_ARTIFACTS.put(
        `runs/${run.id}/summary.json`,
        JSON.stringify(snapshot, null, 2),
        {
          httpMetadata: { contentType: "application/json" },
          customMetadata: { status, createdAt: run.createdAt },
        },
      );
      run.reportReady = true;
    } catch (artifactError) {
      console.error("Unable to persist report", artifactError);
      this.event(
        "artifact-error",
        "The run completed, but its downloadable report could not be stored",
      );
    }
    await this.updateIndex();
    await this.persist();
    await this.env.BUDGET_COORDINATOR.getByName("global").release(run.id);
  }

  private async stopGenerators(): Promise<void> {
    const run = this.requireRun();
    await inBatches(run.assignments, 6, async (assignment) => {
      if (
        ["pending", "complete", "cancelled", "error"].includes(
          assignment.status,
        )
      )
        return;
      try {
        await this.generator(assignment.region, assignment.id).stopRun();
      } catch (error) {
        console.error(`Unable to stop ${assignment.id}`, error);
      }
      assignment.status = "cancelled";
      assignment.latestVus = 0;
      assignment.requestRate = 0;
      assignment.metricBatchAt = undefined;
      assignment.requestRateAt = undefined;
    });
    run.totals.vus = 0;
  }

  private generator(region: RegionCode, name: string) {
    const options = {
      locationHint: REGIONS[region].locationHint as DurableObjectLocationHint,
    };
    switch (region) {
      case "ENAM":
        return this.env.GENERATOR_ENAM.getByName(name, options);
      case "WNAM":
        return this.env.GENERATOR_WNAM.getByName(name, options);
      case "WEUR":
        return this.env.GENERATOR_WEUR.getByName(name, options);
      case "EEUR":
        return this.env.GENERATOR_EEUR.getByName(name, options);
      case "APAC":
        return this.env.GENERATOR_APAC.getByName(name, options);
      case "SAM":
        return this.env.GENERATOR_SAM.getByName(name, options);
    }
  }

  private snapshot(): RunSnapshot {
    const run = this.requireRun();
    const now = Date.now();
    const includeDetailedSeries = TERMINAL_STATUSES.includes(run.status);
    const assignments = run.assignments.map(
      ({
        token: _token,
        latestVus: _vus,
        latestVusMax: _max,
        metricBatchAt: _batchAt,
        requestRateAt,
        ...item
      }) => ({
        ...item,
        requestRate: visibleRequestRate(
          item.status,
          item.requestRate,
          requestRateAt,
          now,
        ),
      }),
    );
    const timeSeries: TimeSeriesPoint[] = Object.entries(run.buckets)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([timestamp, storedBucket]) => {
        const totals = metricBucketTotals(storedBucket);
        const rates = metricBucketRates(storedBucket);
        const point: TimeSeriesPoint = {
          timestamp,
          requests: totals.requests,
          failedRequests: totals.failedRequests,
          requestsPerSecond: rates?.requests,
          failedRequestsPerSecond: rates?.failedRequests,
          vus: totals.vus,
          latencySamples: totals.latency.count,
          latencyAligned: metricBucketLatencyAligned(
            storedBucket,
            run.assignments.length,
          ),
          p95Ms: histogramPercentile(totals.latency, 0.95),
        };
        if (!includeDetailedSeries) return point;
        return {
          ...point,
          checks: totals.checks,
          checksPerSecond: rates?.checks,
          failedChecks: totals.failedChecks,
          failedChecksPerSecond: rates?.failedChecks,
          iterations: totals.iterations,
          iterationsPerSecond: rates?.iterations,
          droppedIterations: totals.droppedIterations,
          droppedIterationsPerSecond: rates?.droppedIterations,
          dataSent: totals.dataSent,
          dataSentPerSecond: rates?.dataSent,
          dataReceived: totals.dataReceived,
          dataReceivedPerSecond: rates?.dataReceived,
          vusMax: totals.vusMax,
          averageLatencyMs:
            totals.latency.count === 0
              ? 0
              : totals.latency.sum / totals.latency.count,
          maxLatencyMs: totals.latency.max,
          p50Ms: histogramPercentile(totals.latency, 0.5),
          p75Ms: histogramPercentile(totals.latency, 0.75),
          p90Ms: histogramPercentile(totals.latency, 0.9),
          p99Ms: histogramPercentile(totals.latency, 0.99),
        };
      });
    return {
      id: run.id,
      status: run.status,
      config: run.config,
      isDemo: run.isDemo,
      createdAt: run.createdAt,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      assignments,
      totals: run.totals,
      peakRequestsPerSecond: run.peakRequestsPerSecond,
      thresholds: evaluateThresholds(run.totals, run.config.thresholds),
      timeSeries,
      events: run.events,
      error: run.error,
      reportReady: run.reportReady,
    };
  }

  private event(type: string, message: string): void {
    const run = this.requireRun();
    run.events.push({ at: new Date().toISOString(), type, message });
    if (run.events.length > 60) run.events.shift();
  }

  private async updateIndex(): Promise<void> {
    const run = this.requireRun();
    const threshold = evaluateThresholds(run.totals, run.config.thresholds);
    const summary = {
      requests: run.totals.requests,
      p95Ms: threshold.p95Ms,
      errorRate: threshold.errorRate,
    };
    await this.env.LOADLAB_DB.prepare(
      `UPDATE runs SET status = ?, started_at = ?, completed_at = ?, summary_json = ?, error = ? WHERE id = ?`,
    )
      .bind(
        run.status,
        run.startedAt ?? null,
        run.completedAt ?? null,
        JSON.stringify(summary),
        run.error ?? null,
        run.id,
      )
      .run();
  }

  private requireRun(): StoredRun {
    if (!this.run) throw new Error("Run coordinator has not been initialized");
    return this.run;
  }

  private async persist(): Promise<void> {
    await this.ctx.storage.put("run", this.requireRun());
  }
}

function isValidBatch(batch: MetricBatch): boolean {
  const values = [
    batch.sequence,
    batch.requests,
    batch.failedRequests,
    batch.checks,
    batch.failedChecks,
    batch.iterations,
    batch.droppedIterations,
    batch.vus,
    batch.vusMax,
    batch.latency.count,
  ];
  return (
    values.every((value) => Number.isFinite(value) && value >= 0) &&
    batch.latency.bounds.length === batch.latency.counts.length &&
    batch.latency.bounds.length <= 50
  );
}

function isValidBatchTimestamp(
  timestamp: string,
  previous: string | undefined,
  run: StoredRun,
  receivedAt: string,
): boolean {
  const time = Date.parse(timestamp);
  const received = Date.parse(receivedAt);
  const started = Date.parse(run.startedAt ?? run.createdAt);
  const previousTime = Date.parse(previous ?? "");
  const deadline = started + (runDurationSeconds(run.config) + 35) * 1_000;
  return (
    Number.isFinite(time) &&
    time >= started - 1_000 &&
    time <= deadline &&
    time <= received + 5_000 &&
    (!Number.isFinite(previousTime) || time > previousTime)
  );
}

function trimBuckets(
  buckets: Record<string, MetricTotals | StoredMetricBucket>,
  maximum: number,
): void {
  const keys = Object.keys(buckets).sort();
  for (const key of keys.slice(0, Math.max(0, keys.length - maximum)))
    delete buckets[key];
}

function ensureMetricBucket(
  run: StoredRun,
  bucketKey: string,
): StoredMetricBucket {
  const existing = run.buckets[bucketKey];
  if (existing && "totals" in existing) {
    existing.rates ??= emptyMetricRates();
    existing.latencyContributors ??= {};
    return existing;
  }

  const totals = existing ?? emptyTotals();
  const bucket: StoredMetricBucket = {
    totals,
    gauges: {},
    rates: emptyMetricRates(),
    latencyContributors: {},
  };
  if (existing) {
    totals.vus = 0;
    totals.vusMax = 0;
    run.assignments.forEach((assignment, index) => {
      setGaugeContribution(totals, bucket.gauges, String(index), {
        vus: assignment.latestVus,
        vusMax: assignment.latestVusMax,
      });
    });
  }
  run.buckets[bucketKey] = bucket;
  return bucket;
}

function metricBucketTotals(
  bucket: MetricTotals | StoredMetricBucket,
): MetricTotals {
  return "totals" in bucket ? bucket.totals : bucket;
}

function metricBucketRates(
  bucket: MetricTotals | StoredMetricBucket,
): StoredMetricRates | undefined {
  return "totals" in bucket ? bucket.rates : undefined;
}

function metricBucketLatencyAligned(
  bucket: MetricTotals | StoredMetricBucket,
  assignmentCount: number,
): boolean | undefined {
  if (!("totals" in bucket)) return undefined;
  return (
    assignmentCount > 0 &&
    Object.keys(bucket.latencyContributors).length === assignmentCount
  );
}

function emptyMetricRates(): StoredMetricRates {
  return {
    requests: 0,
    failedRequests: 0,
    checks: 0,
    failedChecks: 0,
    iterations: 0,
    droppedIterations: 0,
    dataSent: 0,
    dataReceived: 0,
  };
}

function addBatchRates(
  target: StoredMetricRates,
  batch: MetricBatch,
  fraction: number,
): void {
  target.requests += batch.requests * fraction;
  target.failedRequests += batch.failedRequests * fraction;
  target.checks += batch.checks * fraction;
  target.failedChecks += batch.failedChecks * fraction;
  target.iterations += batch.iterations * fraction;
  target.droppedIterations += batch.droppedIterations * fraction;
  target.dataSent += batch.dataSent * fraction;
  target.dataReceived += batch.dataReceived * fraction;
}

async function inBatches<T>(
  values: T[],
  size: number,
  operation: (value: T) => Promise<void>,
): Promise<void> {
  for (let index = 0; index < values.length; index += size) {
    await Promise.all(values.slice(index, index + size).map(operation));
  }
}

function redactConfig(config: RunConfig): RunConfig {
  return {
    ...config,
    tasks: config.tasks.map((task) => ({
      ...task,
      headers: Object.fromEntries(
        Object.entries(task.headers).map(([key, value]) => [
          key,
          /authorization|cookie|api[-_]key|token/i.test(key)
            ? "[redacted]"
            : value,
        ]),
      ),
    })),
  };
}

function finalMessage(status: RunStatus): string {
  switch (status) {
    case "passed":
      return "All global thresholds passed";
    case "failed":
      return "The run completed with one or more threshold failures";
    case "cancelled":
      return "The run was cancelled and all generator leases were released";
    case "error":
      return "The run ended because of an infrastructure error";
    default:
      return `Run entered ${status}`;
  }
}
