import { Badge, LayerCard } from "@cloudflare/kumo";
import {
  ArrowsClockwiseIcon,
  BrowserIcon,
  ChartLineUpIcon,
  CloudIcon,
  CubeIcon,
  DatabaseIcon,
  FileCloudIcon,
  GlobeHemisphereWestIcon,
  ShieldCheckIcon,
  TerminalWindowIcon,
} from "@phosphor-icons/react";

export function Architecture({ capture = false }: { capture?: boolean }) {
  return (
    <div
      className={capture ? "architecture-capture" : "page architecture-page"}
    >
      {!capture && (
        <div className="page-title-row">
          <div>
            <span className="eyebrow">SYSTEM DESIGN</span>
            <h1>One budget, globally partitioned.</h1>
            <p>
              Durable coordination keeps regional generators synchronized
              without multiplying load.
            </p>
          </div>
          <Badge variant="orange" icon={<CubeIcon weight="fill" />}>
            Cloudflare Containers
          </Badge>
        </div>
      )}

      <div className="architecture-diagram-card">
        <div className="arch-backdrop" />
        <div className="arch-title">
          <Badge variant="orange">REFERENCE ARCHITECTURE</Badge>
          <h2>Global Load Lab</h2>
          <p>Synchronized k6 shards on Cloudflare Containers</p>
        </div>
        <svg
          className="arch-connections"
          viewBox="0 0 1000 560"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <marker
              id="arrowOrange"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M0 0l10 5-10 5z" fill="#f48120" />
            </marker>
            <marker
              id="arrowPurple"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M0 0l10 5-10 5z" fill="#8b72ff" />
            </marker>
            <marker
              id="arrowGreen"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M0 0l10 5-10 5z" fill="#38b87c" />
            </marker>
          </defs>
          <path d="M170 263H300" markerEnd="url(#arrowOrange)" />
          <path d="M430 263H535" markerEnd="url(#arrowPurple)" />
          <path d="M740 263H855" markerEnd="url(#arrowOrange)" />
          <path d="M636 350V455H460" markerEnd="url(#arrowGreen)" />
          <path d="M365 350V455H460" markerEnd="url(#arrowGreen)" />
          <path
            className="return-path"
            d="M855 300C760 410 550 405 430 300"
            markerEnd="url(#arrowPurple)"
          />
        </svg>

        <div className="arch-node arch-clients">
          <div className="arch-node-icon blue">
            <BrowserIcon weight="duotone" />
          </div>
          <div>
            <strong>Developers</strong>
            <span>UI · CLI · CI</span>
          </div>
          <div className="client-mini-icons">
            <TerminalWindowIcon /> <ChartLineUpIcon />
          </div>
        </div>

        <div className="arch-node arch-worker">
          <div className="arch-node-icon orange">
            <CloudIcon weight="duotone" />
          </div>
          <div>
            <strong>Worker API</strong>
            <span>Auth · planning · guardrails</span>
          </div>
          <Badge variant="orange">EDGE</Badge>
        </div>

        <div className="arch-node arch-do">
          <div className="arch-node-icon purple">
            <ArrowsClockwiseIcon weight="duotone" />
          </div>
          <div>
            <strong>RunCoordinator</strong>
            <span>Barrier · state · histograms</span>
          </div>
          <Badge variant="purple">DURABLE OBJECT</Badge>
        </div>

        <div className="arch-generator-group">
          <div className="generator-group-heading">
            <div>
              <CubeIcon weight="fill" />
              <strong>Regional generator grid</strong>
            </div>
            <Badge variant="green" appearance="dot">
              SCALE TO ZERO
            </Badge>
          </div>
          <div className="generator-regions">
            {["ENAM", "WNAM", "WEUR", "EEUR", "APAC", "SAM"].map((region) => (
              <div key={region}>
                <CubeIcon weight="duotone" />
                <strong>{region}</strong>
                <span>k6</span>
              </div>
            ))}
          </div>
          <small>
            One constrained Container application per placement pool
          </small>
        </div>

        <div className="arch-node arch-target">
          <div className="arch-node-icon green">
            <ShieldCheckIcon weight="duotone" />
          </div>
          <div>
            <strong>Verified target</strong>
            <span>Exact-host egress allowlist</span>
          </div>
        </div>

        <div className="arch-storage">
          <div>
            <DatabaseIcon weight="duotone" />
            <span>
              <strong>D1</strong>
              Run index
            </span>
          </div>
          <div>
            <FileCloudIcon weight="duotone" />
            <span>
              <strong>R2</strong>
              Reports
            </span>
          </div>
        </div>

        <div className="arch-flow-label label-control">CONTROL</div>
        <div className="arch-flow-label label-load">LOAD</div>
        <div className="arch-flow-label label-metrics">1s METRIC BATCHES</div>
        <div className="arch-footer-label">
          <GlobeHemisphereWestIcon /> REQUESTED REGION → ACTUAL LOCATION
        </div>
      </div>

      {!capture && (
        <div className="architecture-notes">
          <ArchitectureNote
            number="01"
            title="Partition, never multiply"
            copy="Largest-remainder allocation preserves the exact global target while splitting every stage across weighted regional shards."
          />
          <ArchitectureNote
            number="02"
            title="Start behind a barrier"
            copy="Containers report ready first. A shared future timestamp then starts all k6 processes without counting cold-start time."
          />
          <ArchitectureNote
            number="03"
            title="Merge useful primitives"
            copy="Counters sum and fixed latency histograms merge. The control plane never averages p95 values from independent regions."
          />
        </div>
      )}
    </div>
  );
}

function ArchitectureNote({
  number,
  title,
  copy,
}: {
  number: string;
  title: string;
  copy: string;
}) {
  return (
    <LayerCard className="architecture-note">
      <span>{number}</span>
      <h3>{title}</h3>
      <p>{copy}</p>
    </LayerCard>
  );
}
