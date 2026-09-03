import { Badge, Button, LayerCard, Table } from "@cloudflare/kumo";
import {
  ArrowRightIcon,
  ChartLineUpIcon,
  ClockCountdownIcon,
  CubeIcon,
  GitBranchIcon,
  GlobeHemisphereWestIcon,
  PlayIcon,
  ShieldCheckIcon,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { RunListItem } from "../../shared/api";
import { MetricCard } from "../components/MetricCard";
import { StatusBadge } from "../components/StatusBadge";
import { WorldMap } from "../components/WorldMap";
import { api } from "../lib/api";
import { SAMPLE_RUN } from "../lib/sample";

export function Dashboard() {
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .runs()
      .then((response) => setRuns(response.runs))
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }, []);

  async function startDemo() {
    setStarting(true);
    setError("");
    try {
      const run = await api.startDemo();
      window.location.href = `/runs/${run.id}`;
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to start demo",
      );
      setStarting(false);
    }
  }

  return (
    <div className="page dashboard-page">
      <section className="hero-grid">
        <div className="hero-copy">
          <Badge variant="orange">GLOBAL LOAD ORCHESTRATOR</Badge>
          <h1>
            Pressure-test from the <span>whole planet.</span>
          </h1>
          <p>
            Coordinate k6 generator shards across Cloudflare Containers, keep
            one global load budget, and see exactly where your latency begins to
            bend.
          </p>
          <div className="hero-actions">
            <Button
              variant="primary"
              size="lg"
              icon={PlayIcon}
              loading={starting}
              onClick={startDemo}
            >
              Run 20-second demo
            </Button>
            <Button
              variant="secondary"
              size="lg"
              icon={GitBranchIcon}
              onClick={() => (window.location.href = "/new")}
            >
              Configure a test
            </Button>
          </div>
          <div className="hero-trust">
            <span>
              <ShieldCheckIcon weight="fill" /> verified targets only
            </span>
            <span>
              <ClockCountdownIcon weight="fill" /> scale to zero
            </span>
          </div>
          {error && <p className="inline-error">{error}</p>}
        </div>
        <LayerCard className="hero-map-card">
          <div className="hero-map-head">
            <div>
              <span className="eyebrow">REGIONAL FABRIC</span>
              <h2>One run. Six placement pools.</h2>
            </div>
            <span className="live-pill">
              <i /> LIVE
            </span>
          </div>
          <WorldMap assignments={SAMPLE_RUN.assignments} />
        </LayerCard>
      </section>

      <section className="metrics-row" aria-label="Platform summary">
        <MetricCard
          label="Placement pools"
          value="6"
          detail="Strict regional constraints"
          icon={GlobeHemisphereWestIcon}
          tone="orange"
        />
        <MetricCard
          label="Generator runtime"
          value="k6 2.2"
          detail="Pinned, reproducible image"
          icon={CubeIcon}
          tone="purple"
        />
        <MetricCard
          label="Load integrity"
          value="Exact"
          detail="Largest-remainder sharding"
          icon={ChartLineUpIcon}
          tone="green"
        />
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <span className="eyebrow">RUN HISTORY</span>
            <h2>Recent tests</h2>
          </div>
          <Button
            variant="secondary"
            size="sm"
            icon={ArrowRightIcon}
            onClick={() => (window.location.href = "/new")}
          >
            New test
          </Button>
        </div>
        <LayerCard className="table-card">
          {loading ? (
            <div className="empty-state">Loading run history…</div>
          ) : runs.length === 0 ? (
            <div className="empty-state">
              <CubeIcon weight="duotone" />
              <strong>No runs yet</strong>
              <span>
                Launch the bounded demo to wake three regional Containers.
              </span>
            </div>
          ) : (
            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.Head>Run</Table.Head>
                  <Table.Head>Status</Table.Head>
                  <Table.Head>Regions</Table.Head>
                  <Table.Head>Requests</Table.Head>
                  <Table.Head>p95</Table.Head>
                  <Table.Head>Started</Table.Head>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {runs.map((run) => (
                  <Table.Row key={run.id}>
                    <Table.Cell>
                      <a className="run-link" href={`/runs/${run.id}`}>
                        <strong>{run.name}</strong>
                        <small>{run.targetOrigin}</small>
                      </a>
                    </Table.Cell>
                    <Table.Cell>
                      <StatusBadge status={run.status} />
                    </Table.Cell>
                    <Table.Cell>
                      <div className="region-stack">
                        {run.regions.map((region) => (
                          <Badge key={region} variant="neutral">
                            {region}
                          </Badge>
                        ))}
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      {formatNumber(run.summary?.requests ?? 0)}
                    </Table.Cell>
                    <Table.Cell>
                      {run.summary ? `${run.summary.p95Ms} ms` : "—"}
                    </Table.Cell>
                    <Table.Cell>{relativeTime(run.createdAt)}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          )}
        </LayerCard>
      </section>
    </div>
  );
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function relativeTime(value: string): string {
  const seconds = Math.max(
    0,
    Math.round((Date.now() - new Date(value).getTime()) / 1_000),
  );
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`;
  return new Date(value).toLocaleDateString();
}
