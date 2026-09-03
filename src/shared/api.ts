import type {
  GeneratorPlacement,
  MetricBatch,
  MetricTotals,
  ThresholdResult,
} from "./metrics";
import type { PlannedAssignment, RunConfig, RunStatus } from "./types";

export interface AssignmentState extends PlannedAssignment {
  id: string;
  token: string;
  status: "pending" | "ready" | "running" | "complete" | "cancelled" | "error";
  placement?: GeneratorPlacement;
  lastSequence: number;
  lastHeartbeat?: string;
  error?: string;
}

export interface RunEvent {
  at: string;
  type: string;
  message: string;
}

export interface TimeSeriesPoint {
  timestamp: string;
  requests: number;
  failedRequests: number;
  vus: number;
  p95Ms: number;
}

export interface RunSnapshot {
  id: string;
  status: RunStatus;
  config: RunConfig;
  isDemo: boolean;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  assignments: Omit<AssignmentState, "token">[];
  totals: MetricTotals;
  thresholds: ThresholdResult;
  timeSeries: TimeSeriesPoint[];
  events: RunEvent[];
  error?: string;
  reportReady: boolean;
}

export interface AgentPrepareRequest {
  runId: string;
  assignmentId: string;
  callbackUrl: string;
  callbackToken: string;
  targetOrigin: string;
  tasks: RunConfig["tasks"];
  profile: RunConfig["profile"];
  requestedRegion: RunConfig["regions"][number]["code"];
}

export interface AgentPrepareResponse {
  ready: boolean;
  placement: GeneratorPlacement;
  engineVersion: string;
}

export interface AgentCompletePayload {
  runId: string;
  assignmentId: string;
  status: "complete" | "cancelled" | "error";
  error?: string;
  completedAt: string;
}

export interface InternalMetricPayload {
  token: string;
  batch: MetricBatch;
}

export interface InternalCompletePayload extends AgentCompletePayload {
  token: string;
}

export interface RunListItem {
  id: string;
  name: string;
  targetOrigin: string;
  status: RunStatus;
  isDemo: boolean;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  summary?: {
    requests: number;
    p95Ms: number;
    errorRate: number;
  };
  regions: string[];
}

export interface PublicConfig {
  demoEnabled: boolean;
  demoTarget: string;
  repositoryUrl: string;
  regions: Array<{ code: string; label: string }>;
  limits: {
    maxDurationSeconds: number;
    maxRegions: number;
    maxShards: number;
  };
}
