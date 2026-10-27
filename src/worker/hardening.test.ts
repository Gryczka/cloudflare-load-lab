import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readJson } from "./http";
import { publicRead } from "./public-reads";
import { RunCoordinator } from "./durable-objects/run-coordinator";
import { BudgetCoordinator } from "./durable-objects/budget-coordinator";
import { DEMO_RUN_CONFIG } from "../shared/types";
import type { Env } from "./env";

vi.mock("@cloudflare/containers", () => ({
  Container: class {},
  ContainerProxy: class {},
}));
import worker from "./index";

const id = "12345678-1234-1234-1234-123456789abc";
const origin = "https://load.example";
function runtime(initial: Record<string, unknown> = {}) {
  const data = new Map(Object.entries(initial));
  let ready = Promise.resolve();
  const ctx = {
    blockConcurrencyWhile(callback: () => Promise<void>) {
      ready = callback();
      return ready;
    },
    storage: {
      get: vi.fn(async (key: string) => structuredClone(data.get(key))),
      put: vi.fn(async (key: string, value: unknown) => {
        data.set(key, structuredClone(value));
      }),
      setAlarm: vi.fn(async () => {}),
    },
  };
  return {
    ctx: ctx as unknown as DurableObjectState,
    ready: () => ready,
    data,
  };
}
function environment() {
  const statement = {
    bind: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(null),
    run: vi.fn().mockResolvedValue({}),
    all: vi.fn().mockResolvedValue({ results: [] }),
  };
  const stop = vi.fn().mockResolvedValue(undefined);
  const generator = { getByName: vi.fn(() => ({ stopRun: stop })) };
  return {
    ADMIN_TOKEN: "mock-administrator-token",
    PUBLIC_READ_LIMITER: {
      limit: vi.fn().mockResolvedValue({ success: true }),
    },
    CALLBACK_RATE_LIMITER: {
      limit: vi.fn().mockResolvedValue({ success: true }),
    },
    LOADLAB_DB: {
      prepare: vi.fn(() => statement),
      batch: vi.fn().mockResolvedValue([]),
    },
    LOADLAB_ARTIFACTS: { put: vi.fn().mockResolvedValue(undefined) },
    RUN_COORDINATOR: {
      getByName: vi.fn(() => {
        throw new Error("Unexpected per-run dispatch");
      }),
    },
    BUDGET_COORDINATOR: {
      getByName: () => ({ release: vi.fn().mockResolvedValue(undefined) }),
    },
    GENERATOR_ENAM: generator,
    GENERATOR_WEUR: generator,
    GENERATOR_APAC: generator,
    ASSETS: {
      fetch: vi.fn(
        async () =>
          new Response("asset", {
            headers: { "Content-Type": "text/javascript" },
          }),
      ),
    },
  };
}
beforeEach(() => {
  vi.stubGlobal("caches", {
    default: {
      match: vi.fn().mockResolvedValue(undefined),
      put: vi.fn().mockResolvedValue(undefined),
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Remote fetch prohibited in regression tests");
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("public HTTP boundaries", () => {
  it("rejects chunked oversized JSON without buffering an unbounded body", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(5));
        controller.enqueue(new Uint8Array(5));
        controller.close();
      },
    });
    const request = new Request(origin, {
      method: "POST",
      body: stream,
      duplex: "half",
    } as RequestInit);
    await expect(readJson(request, 8)).rejects.toMatchObject({ status: 413 });
  });
  it("times out stalled request bodies", async () => {
    vi.useFakeTimers();
    const request = new Request(origin, {
      method: "POST",
      body: new ReadableStream(),
      duplex: "half",
    } as RequestInit);
    const assertion = expect(readJson(request)).rejects.toMatchObject({
      status: 408,
    });
    await vi.advanceTimersByTimeAsync(10_001);
    await assertion;
  });
  it("rejects unknown snapshot and callback IDs before per-run activation", async () => {
    const env = environment();
    const snapshot = await worker.fetch(
      new Request(`${origin}/api/runs/${id}`),
      env as unknown as Env,
    );
    expect(snapshot.status).toBe(404);
    const callback = await worker.fetch(
      new Request(`${origin}/api/internal/complete`, {
        method: "POST",
        body: JSON.stringify({
          runId: id,
          assignmentId: `${id}-enam-0`,
          token: "x".repeat(36),
        }),
      }),
      env as unknown as Env,
    );
    expect(callback.status).toBe(403);
    expect(env.RUN_COORDINATOR.getByName).not.toHaveBeenCalled();
  });
  it("rejects unauthenticated stop before D1 reads and wraps asset security headers", async () => {
    const env = environment();
    expect(
      (
        await worker.fetch(
          new Request(`${origin}/api/runs/${id}/stop`, { method: "POST" }),
          env as unknown as Env,
        )
      ).status,
    ).toBe(401);
    expect(env.LOADLAB_DB.prepare).not.toHaveBeenCalled();
    const asset = await worker.fetch(
      new Request(`${origin}/assets/app.js`),
      env as unknown as Env,
    );
    expect(asset.headers.get("Content-Security-Policy")).toContain(
      "frame-ancestors 'none'",
    );
    expect(asset.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
  it("shares anonymous cached reads but never caches administrator responses", async () => {
    const env = environment();
    const load = vi.fn(async () => Response.json({ public: true }));
    const request = new Request(`${origin}/api/runs?noise=1`);
    const first = await publicRead(request, env as unknown as Env, 15, load);
    expect(first.headers.get("Cache-Control")).toContain("max-age=15");
    const cache = (caches as CacheStorage & { default: Cache }).default;
    vi.mocked(cache.match).mockResolvedValue(first.clone());
    await publicRead(
      new Request(`${origin}/api/runs?noise=2`),
      env as unknown as Env,
      15,
      load,
    );
    expect(load).toHaveBeenCalledTimes(1);
    const admin = await publicRead(
      new Request(request, {
        headers: { Authorization: `Bearer ${env.ADMIN_TOKEN}` },
      }),
      env as unknown as Env,
      15,
      load,
    );
    expect(admin.headers.get("Cache-Control")).toBe("no-store");
    expect(cache.put).toHaveBeenCalledTimes(1);
    await expect(
      publicRead(
        new Request(request, { headers: { Authorization: "Bearer invalid" } }),
        env as unknown as Env,
        15,
        load,
      ),
    ).rejects.toMatchObject({ status: 401 });
  });
});

describe("confirmed teardown accounting", () => {
  it("reconciles the HTTP initialization-dispatched path after callback-registry D1 failure", async () => {
    const env = environment();
    const release = vi.fn().mockResolvedValue(undefined);
    const state = runtime();
    const configured = {
      ...env,
      PUBLIC_DEMO_MODE: "true",
      RUN_RATE_LIMITER: { limit: async () => ({ success: true }) },
      BUDGET_COORDINATOR: {
        getByName: () => ({ reserve: async () => ({ ok: true }), release }),
      },
    };
    const run = new RunCoordinator(state.ctx, configured as unknown as Env);
    await state.ready();
    Object.assign(configured, { RUN_COORDINATOR: { getByName: () => run } });
    env.LOADLAB_DB.batch
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("D1 callback writer failed"));
    const response = await worker.fetch(
      new Request(`${origin}/api/runs`, {
        method: "POST",
        body: JSON.stringify({ demo: true }),
      }),
      configured as unknown as Env,
    );
    expect(response.status).toBe(500);
    expect(release).toHaveBeenCalled();
    expect(state.data.get("run")).toMatchObject({
      status: "error",
      executionDispatched: false,
    });
    expect(env.GENERATOR_ENAM.getByName().stopRun).not.toHaveBeenCalled();
  });

  it.each(["prepare", "launch"])(
    "recovers a restart during %s and fences the abandoned continuation",
    async (phase) => {
      const env = environment();
      const release = vi.fn().mockResolvedValue(undefined);
      env.BUDGET_COORDINATOR.getByName = () => ({ release });
      let resume!: () => void;
      const paused = new Promise<void>((resolve) => {
        resume = resolve;
      });
      let entered!: () => void;
      const reached = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const prepare = vi.fn(async () => {
        if (phase === "prepare") {
          entered();
          await paused;
        }
        return { placement: {} };
      });
      const launch = vi.fn(async () => {
        if (phase === "launch") {
          entered();
          await paused;
        }
      });
      const stopRun = vi.fn().mockResolvedValue(undefined);
      const generator = { getByName: () => ({ prepare, launch, stopRun }) };
      Object.assign(env, {
        GENERATOR_ENAM: generator,
        GENERATOR_WEUR: generator,
        GENERATOR_APAC: generator,
      });
      const state = runtime();
      const original = new RunCoordinator(state.ctx, env as unknown as Env);
      await state.ready();
      await original.initialize({
        id,
        config: structuredClone(DEMO_RUN_CONFIG),
        targetOrigin: origin,
        callbackBaseUrl: origin,
        isDemo: true,
      });
      const abandoned = original.launch();
      await reached;
      const restored = new RunCoordinator(state.ctx, env as unknown as Env);
      await state.ready();
      await restored.alarm();
      expect(stopRun).toHaveBeenCalledTimes(3);
      expect(release).toHaveBeenCalledWith(id);
      resume();
      await abandoned;
      if (phase === "prepare") expect(launch).not.toHaveBeenCalled();
      expect((await restored.getSnapshot()).status).toBe("error");
      expect((state.data.get("run") as { status: string }).status).toBe(
        "error",
      );
    },
  );
  it("persists recoverable initialization and releases a proven prelaunch D1 failure", async () => {
    const env = environment();
    const release = vi.fn().mockResolvedValue(undefined);
    env.BUDGET_COORDINATOR.getByName = () => ({ release });
    env.LOADLAB_DB.batch.mockRejectedValueOnce(new Error("D1 unavailable"));
    env.LOADLAB_DB.prepare().run.mockRejectedValue(
      new Error("D1 still unavailable"),
    );
    const state = runtime();
    const run = new RunCoordinator(state.ctx, env as unknown as Env);
    await state.ready();
    await expect(
      run.initialize({
        id,
        config: structuredClone(DEMO_RUN_CONFIG),
        targetOrigin: origin,
        callbackBaseUrl: origin,
        isDemo: true,
      }),
    ).rejects.toThrow();
    expect(state.data.get("run")).toMatchObject({
      executionDispatched: false,
      status: "error",
      cleanupPending: false,
    });
    expect(release).toHaveBeenCalledWith(id);
    expect(env.GENERATOR_ENAM.getByName().stopRun).not.toHaveBeenCalled();
    const restored = new RunCoordinator(state.ctx, env as unknown as Env);
    await state.ready();
    expect(await restored.reconcileTeardown()).toBe(true);
  });
  it("retains capacity on destruction failure and retries even pending assignments", async () => {
    const env = environment();
    const release = vi.fn().mockResolvedValue(undefined);
    env.BUDGET_COORDINATOR.getByName = () => ({ release });
    const stop = env.GENERATOR_ENAM.getByName().stopRun;
    stop.mockRejectedValueOnce(new Error("Destruction unconfirmed"));
    const state = runtime();
    const run = new RunCoordinator(state.ctx, env as unknown as Env);
    await state.ready();
    await run.initialize({
      id,
      config: structuredClone(DEMO_RUN_CONFIG),
      targetOrigin: origin,
      callbackBaseUrl: origin,
      isDemo: true,
    });
    (state.data.get("run") as Record<string, unknown>).executionDispatched =
      true;
    const restored = new RunCoordinator(state.ctx, env as unknown as Env);
    await state.ready();
    expect((await restored.stopRun()).status).toBe("stopping");
    expect(stop).toHaveBeenCalledTimes(3);
    expect(release).not.toHaveBeenCalled();
    await restored.alarm();
    expect((await restored.getSnapshot()).status).toBe("cancelled");
    expect(stop).toHaveBeenCalledTimes(4);
    expect(release).toHaveBeenCalledWith(id);
  });
  it("does not release expired generator leases merely because time elapsed", async () => {
    const state = runtime({
      state: {
        day: new Date().toISOString().slice(0, 10),
        demoRunsToday: 2,
        leases: {
          old1: { isDemo: true, expiresAt: 0, regions: { ENAM: 1 } },
          old2: { isDemo: true, expiresAt: 0, regions: { ENAM: 1 } },
        },
      },
    });
    const budget = new BudgetCoordinator(
      state.ctx,
      environment() as unknown as Env,
    );
    await state.ready();
    expect(
      await budget.reserve(id, true, 20, DEMO_RUN_CONFIG.regions),
    ).toMatchObject({ ok: false });
    await budget.alarm();
    expect((await budget.status()).activeDemo).toBe(2);
  });
});
