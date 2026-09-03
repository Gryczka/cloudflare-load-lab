import { Badge, Button, LayerCard, Meter, Table } from "@cloudflare/kumo";
import {
  ArrowLeftIcon,
  CheckCircleIcon,
  ClockCountdownIcon,
  DownloadSimpleIcon,
  GaugeIcon,
  GlobeHemisphereWestIcon,
  PulseIcon,
  StopCircleIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { lazy, Suspense, useEffect, useState } from "react";
import type { RunSnapshot } from "../../shared/api";
import { TERMINAL_STATUSES } from "../../shared/types";
import { MetricCard } from "../components/MetricCard";
import { StatusBadge } from "../components/StatusBadge";
import { WorldMap } from "../components/WorldMap";
import { api, getAdminToken } from "../lib/api";
import { SAMPLE_RUN } from "../lib/sample";

const RunCharts = lazy(() =>
  import("../components/RunCharts").then((module) => ({
    default: module.RunCharts,
  })),
);

export function RunDetail({
  id,
  sample = false,
}: {
  id: string;
  sample?: boolean;
}) {
  const [run, setRun] = useState<RunSnapshot | undefined>(
    sample ? SAMPLE_RUN : undefined,
  );
  const [error, setError] = useState("");
  const [stopping, setStopping] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (sample) return;
    let active = true;
    let timer: number | undefined;
    async function refresh() {
      try {
        const value = await api.run(id);
        if (!active) return;
        setRun(value);
        setError("");
        if (!TERMINAL_STATUSES.includes(value.status)) {
          timer = window.setTimeout(refresh, 1_000);
        }
      } catch (reason) {
        if (active)
          setError(
            reason instanceof Error ? reason.message : "Unable to load run",
          );
      }
    }
    void refresh();
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [id, sample]);

  async function downloadReport() {
    if (!run) return;
    setDownloading(true);
    setError("");
    try {
      const blob = await api.report(run.id);
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `load-lab-${run.id}.json`;
      link.click();
      URL.revokeObjectURL(objectUrl);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to download report",
      );
    } finally {
      setDownloading(false);
    }
  }

  async function stop() {
    if (!run) return;
    setStopping(true);
    try {
      setRun(await api.stop(run.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to stop run");
    } finally {
      setStopping(false);
    }
  }

  if (!run) {
    return (
      <div className="page run-page">
        <div className="loading-run">
          <PulseIcon className="spin" />
          <strong>{error || "Connecting to run coordinator…"}</strong>
        </div>
      </div>
    );
  }

  const latest = run.timeSeries.at(-1);
  const active = !TERMINAL_STATUSES.includes(run.status);
  const canControlRun = Boolean(getAdminToken());
  const thresholdPercent = Math.min(
    100,
    (run.thresholds.p95Ms / run.config.thresholds.p95Ms) * 100,
  );

  return (
    <div className="page run-page">
      <div className="run-title-row">
        <div>
          <a href="/" className="back-link">
            <ArrowLeftIcon /> All runs
          </a>
          <div className="title-with-status">
            <h1>{run.config.name}</h1>
            <StatusBadge status={run.status} />
            {sample && <Badge variant="purple">SAMPLE RUN</Badge>}
          </div>
          <p>
            {run.config.targetOrigin} · {run.id}
          </p>
        </div>
        <div className="run-actions">
          {run.reportReady && !sample && (
            <Button
              variant="secondary"
              icon={DownloadSimpleIcon}
              loading={downloading}
              onClick={downloadReport}
            >
              JSON report
            </Button>
          )}
          {active && canControlRun && (
            <Button
              variant="secondary-destructive"
              icon={StopCircleIcon}
              loading={stopping}
              onClick={stop}
            >
              Stop run
            </Button>
          )}
        </div>
      </div>
      {error && <p className="inline-error">{error}</p>}

      <section className="run-overview-grid">
        <LayerCard className="run-map-panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">GENERATOR GRID</span>
              <h2>Requested vs. actual placement</h2>
            </div>
            {active && (
              <span className="live-pill">
                <i /> LIVE
              </span>
            )}
          </div>
          <WorldMap assignments={run.assignments} />
        </LayerCard>

        <LayerCard className="threshold-panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">GLOBAL GATE</span>
              <h2>Threshold health</h2>
            </div>
            {run.thresholds.passed ? (
              <CheckCircleIcon className="gate-icon gate-pass" weight="fill" />
            ) : (
              <WarningCircleIcon
                className="gate-icon gate-wait"
                weight="fill"
              />
            )}
          </div>
          <div className="threshold-item">
            <Meter
              label="p95 response time"
              value={thresholdPercent}
              customValue={`${run.thresholds.p95Ms} / ${run.config.thresholds.p95Ms} ms`}
              indicatorClassName={
                run.thresholds.checks.latency ? "meter-pass" : "meter-fail"
              }
            />
            <small>
              {run.thresholds.checks.latency
                ? "Inside latency budget"
                : "Outside latency budget"}
            </small>
          </div>
          <div className="threshold-item">
            <Meter
              label="Failed request budget"
              value={Math.min(100, run.thresholds.errorRate * 100 * 10)}
              customValue={`${(run.thresholds.errorRate * 100).toFixed(2)} / ${(run.config.thresholds.errorRate * 100).toFixed(2)}%`}
              indicatorClassName={
                run.thresholds.checks.errors ? "meter-pass" : "meter-fail"
              }
            />
            <small>{run.totals.failedRequests} failed requests globally</small>
          </div>
          <div className="run-phase">
            <span>Current phase</span>
            <strong>{active ? phaseLabel(run.status) : "Complete"}</strong>
            <small>{elapsed(run)} elapsed</small>
          </div>
        </LayerCard>
      </section>

      <section
        className="metrics-row run-metrics"
        aria-label="Live run metrics"
      >
        <MetricCard
          label="Delivered rate"
          value={`${latest?.requests ?? 0} req/s`}
          detail={`${run.totals.iterations.toLocaleString()} iterations`}
          icon={GaugeIcon}
          tone="orange"
        />
        <MetricCard
          label="p95 latency"
          value={`${run.thresholds.p95Ms} ms`}
          detail={`${Math.round(run.totals.latency.max)} ms max`}
          icon={ClockCountdownIcon}
          tone="purple"
        />
        <MetricCard
          label="Total requests"
          value={run.totals.requests.toLocaleString()}
          detail={`${formatBytes(run.totals.dataReceived)} received`}
          icon={PulseIcon}
          tone="green"
        />
        <MetricCard
          label="Active regions"
          value={`${run.assignments.filter((item) => item.status !== "error").length}`}
          detail={`${run.totals.droppedIterations} dropped iterations`}
          icon={GlobeHemisphereWestIcon}
          tone="blue"
        />
      </section>

      <Suspense
        fallback={<div className="chart-loading">Loading metric charts…</div>}
      >
        <RunCharts
          points={run.timeSeries}
          p95Threshold={run.config.thresholds.p95Ms}
        />
      </Suspense>

      <section className="run-lower-grid">
        <LayerCard className="table-card region-table-card">
          <div className="panel-header padded-heading">
            <div>
              <span className="eyebrow">SHARD INVENTORY</span>
              <h2>Regional generators</h2>
            </div>
          </div>
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.Head>Requested</Table.Head>
                <Table.Head>Actual</Table.Head>
                <Table.Head>Location</Table.Head>
                <Table.Head>Weight</Table.Head>
                <Table.Head>State</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {run.assignments.map((assignment) => (
                <Table.Row key={assignment.id}>
                  <Table.Cell>
                    <strong>{assignment.region}</strong>
                  </Table.Cell>
                  <Table.Cell>
                    {assignment.placement?.actualRegion ?? "—"}
                  </Table.Cell>
                  <Table.Cell>
                    <span className="location-code">
                      {assignment.placement?.location?.toUpperCase() ??
                        "WARMING"}
                    </span>
                  </Table.Cell>
                  <Table.Cell>{Math.round(assignment.weight)}%</Table.Cell>
                  <Table.Cell>
                    <Badge
                      variant={
                        assignment.status === "error"
                          ? "red"
                          : assignment.status === "running"
                            ? "orange"
                            : "green"
                      }
                      appearance="dot"
                    >
                      {assignment.status}
                    </Badge>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </LayerCard>

        <LayerCard className="event-card">
          <div className="panel-header padded-heading">
            <div>
              <span className="eyebrow">COORDINATOR LOG</span>
              <h2>Run lifecycle</h2>
            </div>
          </div>
          <ol className="event-list">
            {run.events.slice(-6).map((event, index) => (
              <li key={`${event.at}-${index}`}>
                <i />
                <div>
                  <strong>{event.message}</strong>
                  <span>
                    {new Date(event.at).toLocaleTimeString([], {
                      hour12: false,
                    })}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        </LayerCard>
      </section>
    </div>
  );
}

function phaseLabel(status: RunSnapshot["status"]): string {
  if (status === "queued") return "Queued";
  if (status === "starting") return "Container warm-up";
  if (status === "stopping") return "Graceful drain";
  return "Sustained load";
}

function elapsed(run: RunSnapshot): string {
  if (!run.startedAt) return "0s";
  const end = run.completedAt
    ? new Date(run.completedAt).getTime()
    : Date.now();
  return `${Math.max(0, Math.round((end - new Date(run.startedAt).getTime()) / 1_000))}s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KiB`;
  return `${(bytes / 1_048_576).toFixed(1)} MiB`;
}
