import { ContainerProxy } from "@cloudflare/containers";
import type {
  InternalCompletePayload,
  InternalMetricPayload,
  PublicConfig,
  RunListItem,
} from "../shared/api";
import { estimateRun } from "../shared/planner";
import {
  DEMO_RUN_CONFIG,
  REGIONS,
  runConfigSchema,
  runDurationSeconds,
  type RunConfig,
  type RunStatus,
} from "../shared/types";
import {
  GeneratorAPAC,
  GeneratorEEUR,
  GeneratorENAM,
  GeneratorSAM,
  GeneratorWEUR,
  GeneratorWNAM,
} from "./containers/generator";
import { BudgetCoordinator } from "./durable-objects/budget-coordinator";
import { RunCoordinator } from "./durable-objects/run-coordinator";
import type { Env } from "./env";
import {
  HttpError,
  errorResponse,
  isAdmin,
  json,
  readJson,
  withSecurityHeaders,
} from "./http";

export {
  BudgetCoordinator,
  ContainerProxy,
  GeneratorAPAC,
  GeneratorEEUR,
  GeneratorENAM,
  GeneratorSAM,
  GeneratorWEUR,
  GeneratorWNAM,
  RunCoordinator,
};

interface RunRow {
  id: string;
  name: string;
  target_origin: string;
  status: RunStatus;
  is_demo: number;
  regions_json: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  summary_json: string | null;
  error: string | null;
}

interface TargetRow {
  id: string;
  origin: string;
  challenge: string;
  status: string;
  created_at: string;
  verified_at: string | null;
  expires_at: string | null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/")) {
        return withSecurityHeaders(await api(request, url, env));
      }
      return withSecurityHeaders(await env.ASSETS.fetch(request));
    } catch (error) {
      return withSecurityHeaders(errorResponse(error));
    }
  },
} satisfies ExportedHandler<Env>;

async function api(request: Request, url: URL, env: Env): Promise<Response> {
  if (request.method === "GET" && url.pathname === "/api/config")
    return publicConfig(url, env);
  if (request.method === "GET" && url.pathname === "/api/health") {
    return json({
      ok: true,
      service: "cloudflare-load-lab",
      at: new Date().toISOString(),
    });
  }
  if (request.method === "GET" && url.pathname === "/api/demo-target") {
    return demoTarget(request, url);
  }

  if (request.method === "POST" && url.pathname === "/api/internal/metrics") {
    return ingestMetrics(request, env);
  }
  if (request.method === "POST" && url.pathname === "/api/internal/complete") {
    return completeAssignment(request, env);
  }

  if (url.pathname === "/api/runs" && request.method === "GET") {
    return listRuns(request, env);
  }
  if (url.pathname === "/api/runs" && request.method === "POST") {
    return createRun(request, url, env);
  }

  const runMatch = url.pathname.match(
    /^\/api\/runs\/([0-9a-f-]+)(?:\/(stop|report))?$/,
  );
  if (runMatch) {
    const runId = runMatch[1];
    if (!runId) throw new HttpError(404, "Run not found");
    await authorizeRunRead(request, env, runId);
    if (request.method === "GET" && !runMatch[2]) {
      return json(await env.RUN_COORDINATOR.getByName(runId).getSnapshot());
    }
    if (request.method === "POST" && runMatch[2] === "stop") {
      requireAdmin(request, env);
      return json(await env.RUN_COORDINATOR.getByName(runId).stopRun());
    }
    if (request.method === "GET" && runMatch[2] === "report") {
      const object = await env.LOADLAB_ARTIFACTS.get(
        `runs/${runId}/summary.json`,
      );
      if (!object) throw new HttpError(404, "Report is not ready");
      return new Response(object.body, {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="load-lab-${runId}.json"`,
          "Cache-Control": "private, max-age=60",
        },
      });
    }
  }

  if (url.pathname === "/api/targets" && request.method === "GET") {
    requireAdmin(request, env);
    return listTargets(env);
  }
  if (url.pathname === "/api/targets" && request.method === "POST") {
    requireAdmin(request, env);
    return createTarget(request, env);
  }
  const targetMatch = url.pathname.match(
    /^\/api\/targets\/([0-9a-f-]+)\/verify$/,
  );
  if (targetMatch && request.method === "POST") {
    requireAdmin(request, env);
    const targetId = targetMatch[1];
    if (!targetId) throw new HttpError(404, "Target not found");
    return verifyTarget(targetId, env);
  }

  throw new HttpError(404, "API route not found");
}

function publicConfig(url: URL, env: Env): Response {
  const value: PublicConfig = {
    demoEnabled: env.PUBLIC_DEMO_MODE === "true",
    demoTarget: `${url.origin}/api/demo-target`,
    repositoryUrl: env.REPOSITORY_URL,
    regions: Object.entries(REGIONS).map(([code, region]) => ({
      code,
      label: region.label,
    })),
    limits: { maxDurationSeconds: 3_600, maxRegions: 6, maxShards: 12 },
  };
  return json(value);
}

function demoTarget(request: Request, url: URL): Response {
  const requestedPayload = url.searchParams.get("payload");
  const payloadBytes = requestedPayload === "2kb" ? 2_048 : 128;
  const cf = request.cf as IncomingRequestCfProperties | undefined;
  return json({
    ok: true,
    service: "load-lab-owned-target",
    timestamp: new Date().toISOString(),
    colo: cf?.colo,
    country: cf?.country,
    payload: "x".repeat(payloadBytes),
  });
}

async function createRun(
  request: Request,
  url: URL,
  env: Env,
): Promise<Response> {
  const body = await readJson<
    { demo?: boolean; config?: unknown } & Record<string, unknown>
  >(request);
  const demo = body.demo === true;
  let config: RunConfig;
  let targetOrigin: string;

  if (demo) {
    if (env.PUBLIC_DEMO_MODE !== "true")
      throw new HttpError(403, "Public demo runs are disabled");
    const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
    const rate = await env.RUN_RATE_LIMITER.limit({ key: ip });
    if (!rate.success)
      throw new HttpError(
        429,
        "Please wait before starting another public demo",
      );
    config = structuredClone(DEMO_RUN_CONFIG);
    targetOrigin = containerReachableOrigin(url);
  } else {
    requireAdmin(request, env);
    const parsed = runConfigSchema.safeParse(body.config ?? body);
    if (!parsed.success)
      throw new HttpError(
        400,
        "Invalid run configuration",
        parsed.error.flatten(),
      );
    config = parsed.data;
    targetOrigin = await resolveTarget(config, env);
    enforceCustomLimits(config);
  }

  config.targetOrigin = targetOrigin;
  const rawIdempotencyKey = demo
    ? undefined
    : request.headers.get("idempotency-key")?.trim();
  if (rawIdempotencyKey && rawIdempotencyKey.length > 200) {
    throw new HttpError(400, "Idempotency-Key cannot exceed 200 characters");
  }
  const keyHash = rawIdempotencyKey
    ? await sha256(rawIdempotencyKey)
    : undefined;
  const requestHash = keyHash
    ? await sha256(JSON.stringify(config))
    : undefined;
  if (keyHash) {
    const existing = await env.LOADLAB_DB.prepare(
      "SELECT run_id, request_hash FROM idempotency_keys WHERE key_hash = ?",
    )
      .bind(keyHash)
      .first<{ run_id: string; request_hash: string }>();
    if (existing) {
      if (existing.request_hash !== requestHash) {
        throw new HttpError(
          409,
          "Idempotency-Key was already used for a different configuration",
        );
      }
      return json(
        await env.RUN_COORDINATOR.getByName(existing.run_id).getSnapshot(),
        { status: 200 },
      );
    }
  }

  const id = crypto.randomUUID();
  const budget = env.BUDGET_COORDINATOR.getByName("global");
  const reservation = await budget.reserve(
    id,
    demo,
    runDurationSeconds(config),
    config.regions,
  );
  if (!reservation.ok)
    throw new HttpError(
      429,
      reservation.reason ?? "No generator capacity available",
    );

  const createdAt = new Date().toISOString();
  try {
    const statements = [
      env.LOADLAB_DB.prepare(
        `INSERT INTO runs (id, name, target_origin, status, is_demo, regions_json, created_at)
         VALUES (?, ?, ?, 'queued', ?, ?, ?)`,
      ).bind(
        id,
        config.name,
        targetOrigin,
        demo ? 1 : 0,
        JSON.stringify(config.regions.map((region) => region.code)),
        createdAt,
      ),
    ];
    if (keyHash && requestHash) {
      statements.push(
        env.LOADLAB_DB.prepare(
          "INSERT INTO idempotency_keys (key_hash, request_hash, run_id, created_at) VALUES (?, ?, ?, ?)",
        ).bind(keyHash, requestHash, id, createdAt),
      );
    }
    await env.LOADLAB_DB.batch(statements);

    const coordinator = env.RUN_COORDINATOR.getByName(id);
    const snapshot = await coordinator.initialize({
      id,
      config,
      targetOrigin,
      callbackBaseUrl: containerReachableOrigin(url),
      isDemo: demo,
    });
    return json(snapshot, { status: 202 });
  } catch (error) {
    await budget.release(id);
    if (keyHash && requestHash) {
      const existing = await env.LOADLAB_DB.prepare(
        "SELECT run_id, request_hash FROM idempotency_keys WHERE key_hash = ?",
      )
        .bind(keyHash)
        .first<{ run_id: string; request_hash: string }>();
      if (existing?.request_hash === requestHash) {
        return json(
          await env.RUN_COORDINATOR.getByName(existing.run_id).getSnapshot(),
          { status: 200 },
        );
      }
    }
    throw error;
  }
}

async function listRuns(request: Request, env: Env): Promise<Response> {
  const admin = isAdmin(request, env);
  const statement = admin
    ? env.LOADLAB_DB.prepare(
        "SELECT * FROM runs ORDER BY created_at DESC LIMIT 50",
      )
    : env.LOADLAB_DB.prepare(
        "SELECT * FROM runs WHERE is_demo = 1 ORDER BY created_at DESC LIMIT 20",
      );
  const result = await statement.all<RunRow>();
  const runs: RunListItem[] = result.results.map(rowToListItem);
  return json({ runs });
}

function rowToListItem(row: RunRow): RunListItem {
  return {
    id: row.id,
    name: row.name,
    targetOrigin: row.target_origin,
    status: row.status,
    isDemo: row.is_demo === 1,
    createdAt: row.created_at,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    summary: row.summary_json
      ? (JSON.parse(row.summary_json) as RunListItem["summary"])
      : undefined,
    regions: JSON.parse(row.regions_json) as string[],
  };
}

async function authorizeRunRead(
  request: Request,
  env: Env,
  runId: string,
): Promise<void> {
  if (isAdmin(request, env)) return;
  if (!(await runIsDemo(env, runId)))
    throw new HttpError(401, "Administrator token required");
}

async function runIsDemo(env: Env, runId: string): Promise<boolean> {
  const row = await env.LOADLAB_DB.prepare(
    "SELECT is_demo FROM runs WHERE id = ?",
  )
    .bind(runId)
    .first<{ is_demo: number }>();
  if (!row) throw new HttpError(404, "Run not found");
  return row.is_demo === 1;
}

async function ingestMetrics(request: Request, env: Env): Promise<Response> {
  const payload = await readJson<InternalMetricPayload>(request, 128_000);
  if (!payload?.batch?.runId || !payload.token)
    throw new HttpError(400, "Invalid metric batch");
  const accepted = await env.RUN_COORDINATOR.getByName(
    payload.batch.runId,
  ).ingest(payload.token, payload.batch);
  if (!accepted) throw new HttpError(403, "Metric batch was rejected");
  return json({ accepted: true });
}

async function completeAssignment(
  request: Request,
  env: Env,
): Promise<Response> {
  const payload = await readJson<InternalCompletePayload>(request, 32_000);
  if (!payload?.runId || !payload.token)
    throw new HttpError(400, "Invalid completion payload");
  const accepted = await env.RUN_COORDINATOR.getByName(payload.runId).complete(
    payload.token,
    payload,
  );
  if (!accepted) throw new HttpError(403, "Completion payload was rejected");
  return json({ accepted: true });
}

async function createTarget(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ origin?: string }>(request, 8_000);
  const origin = validateTargetOrigin(body.origin ?? "");
  const id = crypto.randomUUID();
  const challenge = `cloudflare-load-lab=${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await env.LOADLAB_DB.prepare(
    `INSERT INTO targets (id, origin, challenge, status, created_at)
     VALUES (?, ?, ?, 'pending', ?)
     ON CONFLICT(origin) DO UPDATE SET id = excluded.id, challenge = excluded.challenge,
       status = 'pending', created_at = excluded.created_at, verified_at = NULL, expires_at = NULL`,
  )
    .bind(id, origin, challenge, now)
    .run();
  return json(
    {
      id,
      origin,
      challenge,
      wellKnownUrl: `${origin}/.well-known/cloudflare-load-lab.txt`,
      instructions:
        "Serve the challenge as plain text at the well-known URL, then verify.",
    },
    { status: 201 },
  );
}

async function verifyTarget(id: string, env: Env): Promise<Response> {
  const row = await env.LOADLAB_DB.prepare("SELECT * FROM targets WHERE id = ?")
    .bind(id)
    .first<TargetRow>();
  if (!row) throw new HttpError(404, "Target not found");
  if (!isAllowedTargetOrigin(row.origin, env)) {
    const endpoint = `${row.origin}/.well-known/cloudflare-load-lab.txt`;
    const response = await fetch(endpoint, {
      redirect: "manual",
      headers: { "User-Agent": "Cloudflare-Load-Lab-Verifier/0.1" },
    });
    if (!response.ok)
      throw new HttpError(
        400,
        `Verification endpoint returned ${response.status}`,
      );
    const text = (await response.text()).slice(0, 8_192);
    if (!text.includes(row.challenge))
      throw new HttpError(400, "Verification challenge was not found");
  }
  const verifiedAt = new Date();
  const expiresAt = new Date(verifiedAt.getTime() + 24 * 60 * 60 * 1_000);
  await env.LOADLAB_DB.prepare(
    `UPDATE targets SET status = 'verified', verified_at = ?, expires_at = ? WHERE id = ?`,
  )
    .bind(verifiedAt.toISOString(), expiresAt.toISOString(), id)
    .run();
  return json({
    id,
    origin: row.origin,
    status: "verified",
    expiresAt: expiresAt.toISOString(),
  });
}

async function listTargets(env: Env): Promise<Response> {
  const result = await env.LOADLAB_DB.prepare(
    "SELECT id, origin, status, created_at, verified_at, expires_at FROM targets ORDER BY created_at DESC",
  ).all<Omit<TargetRow, "challenge">>();
  return json({
    targets: result.results.map((target) => ({
      id: target.id,
      origin: target.origin,
      status:
        target.status === "verified" &&
        target.expires_at &&
        target.expires_at < new Date().toISOString()
          ? "expired"
          : target.status,
      createdAt: target.created_at,
      verifiedAt: target.verified_at,
      expiresAt: target.expires_at,
    })),
  });
}

async function resolveTarget(config: RunConfig, env: Env): Promise<string> {
  if (config.targetId !== "demo") {
    const target = await env.LOADLAB_DB.prepare(
      `SELECT origin, status, expires_at FROM targets WHERE id = ?`,
    )
      .bind(config.targetId)
      .first<Pick<TargetRow, "origin" | "status" | "expires_at">>();
    if (
      target?.status === "verified" &&
      target.expires_at &&
      target.expires_at > new Date().toISOString()
    ) {
      return target.origin;
    }
  }

  if (config.targetOrigin) {
    const origin = validateTargetOrigin(config.targetOrigin);
    if (isAllowedTargetOrigin(origin, env)) return origin;
  }
  throw new HttpError(
    403,
    "Target must be verified or included in ALLOWED_TARGET_HOSTS",
  );
}

function isAllowedTargetOrigin(origin: string, env: Env): boolean {
  const allowed = env.ALLOWED_TARGET_HOSTS.split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(new URL(origin).hostname.toLowerCase());
}

function validateTargetOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HttpError(400, "Target must be a valid URL");
  }
  if (url.protocol !== "https:")
    throw new HttpError(400, "Custom targets must use HTTPS");
  if (url.username || url.password)
    throw new HttpError(400, "Target URLs cannot contain credentials");
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new HttpError(
      400,
      "Provide only the target origin; paths belong in tasks",
    );
  }
  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "0.0.0.0" ||
    hostname.startsWith("127.") ||
    hostname === "::1" ||
    hostname.startsWith("169.254.") ||
    hostname.endsWith(".internal")
  ) {
    throw new HttpError(400, "Private and local targets are not allowed");
  }
  return url.origin;
}

function enforceCustomLimits(config: RunConfig): void {
  const estimate = estimateRun(config);
  if (estimate.shardCount > 12)
    throw new HttpError(400, "A run can use at most 12 shards");
  if (runDurationSeconds(config) > 3_600)
    throw new HttpError(400, "A run can last at most one hour");
  const peak = Math.max(
    config.profile.initialTarget,
    ...config.profile.stages.map((stage) => stage.target),
  );
  if (peak > 10_000)
    throw new HttpError(
      400,
      "The configured deployment caps runs at 10,000 units/s",
    );
}

function requireAdmin(request: Request, env: Env): void {
  if (!isAdmin(request, env))
    throw new HttpError(401, "Administrator token required");
}

function containerReachableOrigin(url: URL): string {
  if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
    const port = url.port ? `:${url.port}` : "";
    return `${url.protocol}//host.docker.internal${port}`;
  }
  return url.origin;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
