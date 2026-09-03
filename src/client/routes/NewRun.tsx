import {
  Banner,
  Badge,
  Button,
  Input,
  LayerCard,
  Select,
} from "@cloudflare/kumo";
import {
  ArrowRightIcon,
  CheckIcon,
  CubeIcon,
  GaugeIcon,
  KeyIcon,
  PlayIcon,
  ShieldCheckIcon,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { estimateRun } from "../../shared/planner";
import {
  DEMO_RUN_CONFIG,
  REGIONS,
  REGION_CODES,
  runConfigSchema,
  type RegionCode,
} from "../../shared/types";
import { api, getAdminToken, setAdminToken } from "../lib/api";

type Target = { id: string; origin: string; status: string };

export function NewRun() {
  const [name, setName] = useState("Checkout API load test");
  const [path, setPath] = useState("/api/health");
  const [mode, setMode] = useState<"arrival-rate" | "virtual-users">(
    "arrival-rate",
  );
  const [peak, setPeak] = useState(120);
  const [duration, setDuration] = useState(60);
  const [p95, setP95] = useState(500);
  const [errorRate, setErrorRate] = useState(1);
  const [regions, setRegions] = useState<RegionCode[]>([
    "ENAM",
    "WEUR",
    "APAC",
  ]);
  const [token, setToken] = useState(getAdminToken());
  const [targets, setTargets] = useState<Target[]>([]);
  const [targetId, setTargetId] = useState("demo");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) return;
    api
      .targets()
      .then((response) =>
        setTargets(
          response.targets.filter((target) => target.status === "verified"),
        ),
      )
      .catch(() => setTargets([]));
  }, [token]);

  const configResult = useMemo(() => {
    const ramp = Math.max(1, Math.floor(duration * 0.25));
    const cooldown = ramp;
    const hold = Math.max(1, duration - ramp - cooldown);
    const weight = 100 / Math.max(1, regions.length);
    return runConfigSchema.safeParse({
      version: 1,
      name,
      targetId,
      tasks: [
        {
          name: "Primary request",
          method: "GET",
          path,
          headers: {},
          expectedStatusMin: 200,
          expectedStatusMax: 399,
          thinkTimeMs: 0,
        },
      ],
      profile: {
        mode,
        initialTarget: Math.max(1, Math.round(peak * 0.1)),
        stages: [
          { durationSeconds: ramp, target: peak },
          { durationSeconds: hold, target: peak },
          {
            durationSeconds: cooldown,
            target: Math.max(1, Math.round(peak * 0.1)),
          },
        ],
        maxVus: Math.max(50, peak * 2),
      },
      regions: regions.map((code) => ({ code, weight, shards: 1 })),
      thresholds: { p95Ms: p95, errorRate: errorRate / 100 },
      metadata: { source: "web-ui" },
    });
  }, [duration, errorRate, mode, name, p95, path, peak, regions, targetId]);
  const config = configResult.success ? configResult.data : DEMO_RUN_CONFIG;
  const estimate = estimateRun(config);
  const ownerMode = Boolean(token && targetId !== "demo");

  function toggleRegion(code: RegionCode) {
    setRegions((current) =>
      current.includes(code)
        ? current.length === 1
          ? current
          : current.filter((region) => region !== code)
        : [...current, code],
    );
  }

  function saveToken() {
    setAdminToken(token.trim());
    setToken(token.trim());
  }

  async function submit() {
    setError("");
    if (ownerMode && !configResult.success) {
      setError(
        configResult.error.issues[0]?.message ??
          "The run configuration is invalid",
      );
      return;
    }
    setStarting(true);
    try {
      const run = ownerMode ? await api.start(config) : await api.startDemo();
      window.location.href = `/runs/${run.id}`;
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to start run",
      );
      setStarting(false);
    }
  }

  return (
    <div className="page form-page">
      <div className="page-title-row">
        <div>
          <span className="eyebrow">NEW DISTRIBUTED RUN</span>
          <h1>Shape the pressure.</h1>
          <p>
            Define one global budget. Load Lab divides it across every selected
            shard.
          </p>
        </div>
        <Badge variant={ownerMode ? "green" : "orange"} appearance="dot">
          {ownerMode ? "Owner mode" : "Safe demo mode"}
        </Badge>
      </div>

      {!ownerMode && (
        <Banner
          icon={<ShieldCheckIcon weight="fill" />}
          title="The public garden runs a bounded scenario"
          description="Add the deployment's administrator token and a verified target to run this custom plan. Without it, the button launches a safe 20-second test against Load Lab itself."
        />
      )}

      <div className="builder-layout">
        <div className="builder-main">
          <BuilderSection
            number="01"
            title="Test identity"
            detail="Name this result and select an approved origin."
          >
            <div className="field-grid field-grid-two">
              <Input
                label="Run name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              <Select
                label="Target"
                value={targetId}
                onValueChange={(value) => setTargetId(value ?? "demo")}
                items={{
                  demo: "Owned demo endpoint",
                  ...Object.fromEntries(
                    targets.map((target) => [target.id, target.origin]),
                  ),
                }}
              />
            </div>
            <Input
              label="Request path"
              description="Origin-relative paths only; redirects are disabled."
              value={path}
              onChange={(event) => setPath(event.target.value)}
            />
          </BuilderSection>

          <BuilderSection
            number="02"
            title="Load shape"
            detail="Arrival rate avoids coordinated omission; VUs model closed-loop traffic."
          >
            <div className="field-grid field-grid-three">
              <Select
                label="Executor"
                value={mode}
                onValueChange={(value) => setMode(value ?? "arrival-rate")}
                items={{
                  "arrival-rate": "Arrival rate",
                  "virtual-users": "Virtual users",
                }}
              />
              <Input
                label={
                  mode === "arrival-rate"
                    ? "Peak iterations / sec"
                    : "Peak virtual users"
                }
                type="number"
                min={1}
                max={10_000}
                value={peak}
                onChange={(event) => setPeak(Number(event.target.value))}
              />
              <Input
                label="Duration (seconds)"
                type="number"
                min={5}
                max={3_600}
                value={duration}
                onChange={(event) => setDuration(Number(event.target.value))}
              />
            </div>
            <LoadShape peak={peak} duration={duration} />
          </BuilderSection>

          <BuilderSection
            number="03"
            title="Regional distribution"
            detail="Each pool is a separately constrained Container application."
          >
            <div className="region-picker">
              {REGION_CODES.map((code) => {
                const selected = regions.includes(code);
                return (
                  <button
                    type="button"
                    key={code}
                    className={`region-choice ${selected ? "selected" : ""}`}
                    onClick={() => toggleRegion(code)}
                  >
                    <span className="region-check">
                      {selected && <CheckIcon weight="bold" />}
                    </span>
                    <strong>{code}</strong>
                    <small>{REGIONS[code].shortLabel}</small>
                  </button>
                );
              })}
            </div>
          </BuilderSection>

          <BuilderSection
            number="04"
            title="Pass / fail thresholds"
            detail="Thresholds are evaluated over the merged global histogram."
          >
            <div className="field-grid field-grid-two">
              <Input
                label="p95 latency under (ms)"
                type="number"
                min={1}
                value={p95}
                onChange={(event) => setP95(Number(event.target.value))}
              />
              <Input
                label="Failed requests under (%)"
                type="number"
                min={0.01}
                max={100}
                step={0.01}
                value={errorRate}
                onChange={(event) => setErrorRate(Number(event.target.value))}
              />
            </div>
          </BuilderSection>

          <BuilderSection
            number="05"
            title="Owner credentials"
            detail="Kept in session storage and sent only as a Bearer token."
          >
            <div className="token-row">
              <Input
                label="Administrator token"
                type="password"
                value={token}
                placeholder="Required for verified targets"
                onChange={(event) => setToken(event.target.value)}
                className="token-input"
              />
              <Button variant="secondary" icon={KeyIcon} onClick={saveToken}>
                Apply token
              </Button>
              <Button
                variant="ghost"
                onClick={() => (window.location.href = "/targets")}
              >
                Verify a target
              </Button>
            </div>
          </BuilderSection>
        </div>

        <aside className="review-column">
          <LayerCard className="review-card">
            <div className="review-header">
              <span className="eyebrow">PLAN REVIEW</span>
              <Badge variant="neutral">v1</Badge>
            </div>
            <ReviewLine
              icon={CubeIcon}
              label="Generator shards"
              value={`${estimate.shardCount}`}
            />
            <ReviewLine
              icon={GaugeIcon}
              label="Peak global load"
              value={`${peak} ${mode === "arrival-rate" ? "iter/s" : "VUs"}`}
            />
            <ReviewLine
              icon={ArrowRightIcon}
              label="Generator time"
              value={`${estimate.generatorSeconds}s`}
            />
            <div className="distribution-review">
              <span>Distribution</span>
              {regions.map((region) => (
                <div key={region}>
                  <strong>{region}</strong>
                  <i style={{ width: `${100 / regions.length}%` }} />
                  <small>{Math.round(100 / regions.length)}%</small>
                </div>
              ))}
            </div>
            <div className="review-divider" />
            <div className="cost-note">
              <ShieldCheckIcon />
              <span>
                Compute is billed only while shards are active. This plan is
                always checked against server-side caps.
              </span>
            </div>
            {error && <p className="inline-error">{error}</p>}
            <Button
              variant="primary"
              size="lg"
              icon={PlayIcon}
              loading={starting}
              onClick={submit}
            >
              {ownerMode ? "Launch global run" : "Run bounded demo"}
            </Button>
          </LayerCard>
        </aside>
      </div>
    </div>
  );
}

function BuilderSection({
  number,
  title,
  detail,
  children,
}: {
  number: string;
  title: string;
  detail: string;
  children: React.ReactNode;
}) {
  return (
    <LayerCard className="builder-section">
      <div className="builder-heading">
        <span>{number}</span>
        <div>
          <h2>{title}</h2>
          <p>{detail}</p>
        </div>
      </div>
      <div className="builder-fields">{children}</div>
    </LayerCard>
  );
}

function LoadShape({ peak, duration }: { peak: number; duration: number }) {
  return (
    <div
      className="load-shape"
      aria-label={`Ramp to ${peak}, hold, then ramp down over ${duration} seconds`}
    >
      <div className="shape-grid" />
      <svg viewBox="0 0 500 90" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="shapeFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#f48120" stopOpacity=".38" />
            <stop offset="1" stopColor="#f48120" stopOpacity=".02" />
          </linearGradient>
        </defs>
        <path
          d="M0 83 L120 15 L380 15 L500 75 L500 90 L0 90Z"
          fill="url(#shapeFill)"
        />
        <path
          d="M0 83 L120 15 L380 15 L500 75"
          fill="none"
          stroke="#f48120"
          strokeWidth="3"
        />
      </svg>
      <div className="shape-labels">
        <span>0s</span>
        <span>peak {peak}</span>
        <span>{duration}s</span>
      </div>
    </div>
  );
}

function ReviewLine({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof CubeIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="review-line">
      <Icon weight="duotone" />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
