import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AgentPrepareRequest } from "../../shared/api";
import { DEMO_RUN_CONFIG } from "../../shared/types";
import type { Env } from "../env";
import { RunCoordinator } from "../durable-objects/run-coordinator";
import { BudgetCoordinator } from "../durable-objects/budget-coordinator";

const runtime = vi.hoisted(() => ({
  start: vi.fn(),
  destroy: vi.fn(),
  fetch: vi.fn(),
  autoStartFetch: vi.fn(() => {
    throw new Error("Auto-start fetch is forbidden");
  }),
}));
vi.mock("@cloudflare/containers", () => ({
  Container: class {
    constructor(protected ctx: DurableObjectState) {}
    setAllowedHosts = vi.fn().mockResolvedValue(undefined);
    setDeniedHosts = vi.fn().mockResolvedValue(undefined);
    startAndWaitForPorts = runtime.start;
    containerFetch = runtime.autoStartFetch;
    renewActivityTimeout = vi.fn();
    destroy = runtime.destroy;
  },
}));
import { GENERATOR_DEADLINES, GeneratorENAM } from "./generator";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function state() {
  const values = new Map<string, unknown>();
  let ready = Promise.resolve();
  const ctx = {
    blockConcurrencyWhile(callback: () => Promise<void>) {
      ready = callback();
      return ready;
    },
    storage: {
      get: async (key: string) => structuredClone(values.get(key)),
      put: async (key: string, value: unknown) => {
        values.set(key, structuredClone(value));
      },
      setAlarm: vi.fn().mockResolvedValue(undefined),
    },
    container: { getTcpPort: () => ({ fetch: runtime.fetch }) },
  } as unknown as DurableObjectState<{}>;
  return { ctx, values, ready: () => ready };
}
const config = {
  runId: "12345678-1234-1234-1234-123456789abc",
  assignmentId: "assignment",
  targetOrigin: "https://target.example",
  callbackUrl: "https://callback.example",
} as AgentPrepareRequest;
const phases = ["prepare-fetch", "prepare-body", "start-fetch"] as const;
type Phase = (typeof phases)[number];
function stall(phase: Phase, late = deferred<Response>()) {
  const reached = deferred();
  const cancel = vi.fn(() => new Promise<void>(() => {}));
  let signal: AbortSignal | undefined;
  runtime.fetch.mockImplementation((url: string, init: RequestInit) => {
    if (url.endsWith(phase === "start-fetch" ? "/start" : "/prepare")) {
      signal = init.signal!;
      if (phase === "prepare-body")
        return Promise.resolve(
          new Response(
            new ReadableStream({
              pull() {
                reached.resolve();
                return new Promise<void>(() => {});
              },
              cancel,
            }),
          ),
        );
      reached.resolve();
      return late.promise; // Deliberately ignores abort forever.
    }
    return Promise.resolve(Response.json({ placement: {} }));
  });
  return { reached: reached.promise, signal: () => signal!, cancel, late };
}
async function begin(generator: GeneratorENAM, phase: Phase) {
  if (phase === "start-fetch") {
    await generator.prepare(config, "generation");
    return {
      operation: generator.launch(new Date().toISOString(), "generation"),
    };
  }
  return { operation: generator.prepare(config, "generation") };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  runtime.start.mockResolvedValue(undefined);
  runtime.destroy.mockResolvedValue(undefined);
  runtime.fetch.mockImplementation(async () =>
    Response.json({ placement: {} }),
  );
  runtime.autoStartFetch.mockImplementation(() => {
    throw new Error("Auto-start fetch is forbidden");
  });
});
afterEach(() => vi.useRealTimers());

it.each(phases)(
  "aborts permanently unresolved %s at an absolute deadline and permits bounded destruction",
  async (phase) => {
    const fixture = state();
    const generator = new GeneratorENAM(fixture.ctx, {} as Env);
    const blocked = stall(phase);
    const { operation } = await begin(generator, phase);
    const failed = expect(operation).rejects.toThrow("deadline");
    await blocked.reached;
    await vi.advanceTimersByTimeAsync(GENERATOR_DEADLINES.io + 1);
    await failed;
    expect(blocked.signal().aborted).toBe(true);
    await generator.stopRun();
    expect(runtime.destroy).toHaveBeenCalledOnce();
    expect(runtime.autoStartFetch).not.toHaveBeenCalled();
    if (phase === "prepare-body") expect(blocked.cancel).toHaveBeenCalledOnce();
  },
);

it.each(
  phases.flatMap((phase) =>
    (["unresolved", "failed"] as const).map((teardown) => ({
      phase,
      teardown,
    })),
  ),
)(
  "revokes permanently unresolved $phase with $teardown destruction; capacity held until confirmation and retry",
  async ({ phase, teardown }) => {
    const generatorState = state();
    const generator = new GeneratorENAM(generatorState.ctx, {} as Env);
    const configured = {
      LOADLAB_DB: {
        prepare: () => ({
          bind() {
            return this;
          },
          run: async () => ({}),
        }),
        batch: async () => [],
      },
      LOADLAB_ARTIFACTS: { put: async () => undefined },
      GENERATOR_ENAM: { getByName: () => generator },
    };
    const budgetState = state();
    const budget = new BudgetCoordinator(
      budgetState.ctx,
      configured as unknown as Env,
    );
    await budgetState.ready();
    Object.assign(configured, {
      BUDGET_COORDINATOR: { getByName: () => budget },
    });
    const runState = state();
    const run = new RunCoordinator(runState.ctx, configured as unknown as Env);
    await runState.ready();
    const runConfig = structuredClone(DEMO_RUN_CONFIG);
    runConfig.regions = [{ code: "ENAM", shards: 1, weight: 1 }];
    expect(
      await budget.reserve(config.runId, true, 20, runConfig.regions),
    ).toEqual({ ok: true });
    await run.initialize({
      id: config.runId,
      config: runConfig,
      targetOrigin: config.targetOrigin,
      callbackBaseUrl: config.callbackUrl,
      isDemo: true,
    });
    const blocked = stall(phase);
    const launching = run.launch();
    await blocked.reached;
    const generation = generatorState.values.get("generation") as string;
    const queuedLaunch = expect(
      generator.launch(new Date().toISOString(), generation),
    ).rejects.toThrow("revoked");
    const queuedPrepare = expect(
      generator.prepare(config, generation),
    ).rejects.toThrow("revoked");
    const confirmation = deferred();
    const destroying = deferred();
    runtime.destroy.mockImplementationOnce(() => {
      destroying.resolve();
      return teardown === "unresolved"
        ? confirmation.promise
        : Promise.reject(new Error("Runtime destroy failed"));
    });
    const stopping = run.stopRun();
    await destroying.promise;
    expect(blocked.signal().aborted).toBe(true);
    expect(await budget.status()).toMatchObject({
      activeDemo: 1,
      activeGenerators: 1,
    });
    if (teardown === "unresolved")
      await vi.advanceTimersByTimeAsync(GENERATOR_DEADLINES.destroy + 1);
    expect((await stopping).status).toBe("stopping");
    await launching;
    await queuedLaunch;
    await queuedPrepare;
    expect(await budget.status()).toMatchObject({
      activeDemo: 1,
      activeGenerators: 1,
    });
    expect(
      Number(vi.mocked(runState.ctx.storage.setAlarm).mock.lastCall?.[0]),
    ).toBeGreaterThan(Date.now());
    confirmation.resolve();
    await confirmation.promise;
    await run.alarm();
    expect((await run.getSnapshot()).status).toBe("cancelled");
    expect(await budget.status()).toMatchObject({
      activeDemo: 0,
      activeGenerators: 0,
    });
    const restored = new GeneratorENAM(generatorState.ctx, {} as Env);
    await expect(restored.prepare(config, generation)).rejects.toThrow(
      "revoked",
    );
    await expect(
      restored.launch(new Date().toISOString(), generation),
    ).rejects.toThrow("revoked");
    await expect(restored.runStatus()).rejects.toThrow("revoked");
    expect(runtime.start).toHaveBeenCalledOnce();
    expect(runtime.fetch).toHaveBeenCalledTimes(
      phase === "start-fetch" ? 2 : 1,
    );
    expect(runtime.autoStartFetch).not.toHaveBeenCalled();
  },
);

it("fences a delayed SDK startup before destroy rather than acknowledging a possible late restart", async () => {
  const fixture = state();
  const generator = new GeneratorENAM(fixture.ctx, {} as Env);
  const starting = deferred();
  const entered = deferred();
  const order: string[] = [];
  let signal!: AbortSignal;
  runtime.start.mockImplementationOnce(async (options) => {
    signal = options.cancellationOptions.abort;
    entered.resolve();
    await starting.promise;
    order.push("late-runtime-start");
  });
  runtime.destroy.mockImplementation(async () => {
    order.push("runtime-destroyed");
  });
  const preparing = expect(
    generator.prepare(config, "generation"),
  ).rejects.toThrow("revoked");
  await entered.promise;
  const failed = expect(generator.stopRun()).rejects.toThrow("deadline");
  await vi.advanceTimersByTimeAsync(GENERATOR_DEADLINES.destroy + 1);
  await failed;
  await preparing;
  expect(signal.aborted).toBe(true);
  expect(runtime.destroy).not.toHaveBeenCalled();
  starting.resolve();
  await vi.advanceTimersByTimeAsync(0);
  await generator.stopRun();
  expect(order).toEqual(["late-runtime-start", "runtime-destroyed"]);
  expect(runtime.fetch).not.toHaveBeenCalled();
  await expect(generator.prepare(config, "generation")).rejects.toThrow(
    "revoked",
  );
  expect(runtime.start).toHaveBeenCalledOnce();
});

it("late fetch completion cannot drain the body, issue a queued start or revive a destroyed generation", async () => {
  const fixture = state();
  const generator = new GeneratorENAM(fixture.ctx, {} as Env);
  const blocked = stall("prepare-fetch");
  const preparing = expect(
    generator.prepare(config, "generation"),
  ).rejects.toThrow("revoked");
  await blocked.reached;
  const launching = expect(
    generator.launch(new Date().toISOString(), "generation"),
  ).rejects.toThrow("revoked");
  await generator.stopRun();
  const pull = vi.fn();
  const cancel = vi.fn();
  blocked.late.resolve(
    new Response(new ReadableStream({ pull, cancel }, { highWaterMark: 0 })),
  );
  await preparing;
  await launching;
  await vi.advanceTimersByTimeAsync(0);
  expect(pull).not.toHaveBeenCalled();
  expect(cancel).toHaveBeenCalledOnce();
  expect(runtime.fetch).toHaveBeenCalledOnce();
  expect(runtime.start).toHaveBeenCalledOnce();
  expect(runtime.destroy).toHaveBeenCalledOnce();
});

it("keeps one raw destruction in flight across bounded failures, coalesces callers, then retries a failed runtime destroy", async () => {
  const fixture = state();
  const generator = new GeneratorENAM(fixture.ctx, {} as Env);
  await generator.prepare(config, "generation");
  const destruction = deferred();
  runtime.destroy.mockReturnValueOnce(destruction.promise);
  const first = expect(generator.stopRun()).rejects.toThrow("deadline");
  const concurrent = expect(generator.stopRun()).rejects.toThrow("deadline");
  await vi.advanceTimersByTimeAsync(GENERATOR_DEADLINES.destroy + 1);
  await first;
  await concurrent;
  const retry = expect(generator.stopRun()).rejects.toThrow(
    "failed runtime destroy",
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(runtime.destroy).toHaveBeenCalledOnce();
  destruction.reject(new Error("failed runtime destroy"));
  await retry;
  await generator.stopRun();
  expect(runtime.destroy).toHaveBeenCalledTimes(2);
  await expect(
    generator.launch(new Date().toISOString(), "generation"),
  ).rejects.toThrow("revoked");
  expect(runtime.fetch).toHaveBeenCalledOnce();
});

it("uses a single body deadline despite trickling bytes and a cancellation promise that never settles", async () => {
  const fixture = state();
  const generator = new GeneratorENAM(fixture.ctx, {} as Env);
  const reached = deferred();
  let timer: ReturnType<typeof setInterval>;
  const cancel = vi.fn(() => {
    clearInterval(timer);
    return new Promise<void>(() => {});
  });
  runtime.fetch.mockImplementationOnce(
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            timer = setInterval(
              () => controller.enqueue(new TextEncoder().encode(" ")),
              1000,
            );
            reached.resolve();
          },
          cancel,
        }),
      ),
  );
  const failed = expect(
    generator.prepare(config, "generation"),
  ).rejects.toThrow("deadline");
  await reached.promise;
  await vi.advanceTimersByTimeAsync(GENERATOR_DEADLINES.io + 1);
  await failed;
  expect(cancel).toHaveBeenCalledOnce();
  await generator.stopRun();
  expect(runtime.destroy).toHaveBeenCalledOnce();
});

it("bounds failure response bodies and preserves successful prepare/start behavior", async () => {
  const fixture = state();
  const generator = new GeneratorENAM(fixture.ctx, {} as Env);
  runtime.fetch.mockResolvedValueOnce(
    new Response("x".repeat(64 * 1024 + 1), { status: 500 }),
  );
  await expect(generator.prepare(config, "generation")).rejects.toThrow(
    "64 KiB",
  );
  expect(await generator.prepare(config, "generation")).toEqual({
    placement: {},
  });
  await generator.launch(new Date().toISOString(), "generation");
  await generator.stopRun();
  expect(runtime.destroy).toHaveBeenCalledOnce();
  expect(runtime.autoStartFetch).not.toHaveBeenCalled();
});
