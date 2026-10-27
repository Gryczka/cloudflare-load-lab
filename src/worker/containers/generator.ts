import { Container } from "@cloudflare/containers";
import type {
  AgentPrepareRequest,
  AgentPrepareResponse,
} from "../../shared/api";
import type { Env } from "../env";

export const GENERATOR_DEADLINES = {
  prepare: 60_000,
  io: 10_000,
  destroy: 10_000,
} as const;

/** Abort even when an upstream promise ignores its signal; consume late failures. */
async function interruptible<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  let abort!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
  try {
    return await Promise.race([operation, cancelled]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

/** One absolute deadline, including all body reads, not a timeout per chunk. */
async function deadline<T>(
  milliseconds: number,
  parent: AbortSignal | undefined,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort(parent?.reason);
  parent?.addEventListener("abort", cancel, { once: true });
  if (parent?.aborted) cancel();
  const timer = setTimeout(
    () => controller.abort(new Error("Generator operation deadline exceeded")),
    milliseconds,
  );
  try {
    controller.signal.throwIfAborted();
    return await interruptible(operation(controller.signal), controller.signal);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener("abort", cancel);
  }
}

async function agentBody(
  response: Response,
  signal: AbortSignal,
): Promise<string> {
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let complete = false;
  try {
    while (reader) {
      const part = await interruptible(reader.read(), signal);
      signal.throwIfAborted();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > 64 * 1024)
        throw new Error("Generator response exceeds 64 KiB");
      chunks.push(part.value);
    }
    complete = true;
  } finally {
    // Cancellation itself can stall; it must never hold the teardown queue.
    if (!complete) void reader?.cancel().catch(() => {});
    reader?.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

class LoadGenerator extends Container<Env> {
  defaultPort = 8080;
  requiredPorts = [8080];
  pingEndpoint = "container/health";
  sleepAfter = "45s";
  enableInternet = false;
  interceptHttps = true;
  private operations: Promise<unknown> = Promise.resolve();
  private revoked = false;
  private active = new Set<AbortController>();
  // Raw SDK starts can have delayed side effects even after our deadline fires.
  private starts = new Set<Promise<void>>();
  private teardown?: Promise<void>;
  private destruction?: Promise<void>;

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operations.then(operation);
    this.operations = next.catch(() => {});
    return next;
  }

  private async assertGeneration(generation: string): Promise<void> {
    if (
      this.revoked ||
      (await this.ctx.storage.get("revoked")) ||
      (await this.ctx.storage.get("generation")) !== generation
    )
      throw new Error("Generator startup was revoked");
  }

  private guarded<T>(
    milliseconds: number,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    this.active.add(controller);
    if (this.revoked)
      controller.abort(new Error("Generator startup was revoked"));
    return deadline(milliseconds, controller.signal, (signal) =>
      this.serialized(async () => {
        signal.throwIfAborted();
        const result = await operation(signal);
        signal.throwIfAborted();
        if (this.revoked) throw new Error("Generator startup was revoked");
        return result;
      }),
    ).finally(() => this.active.delete(controller));
  }

  private async check(generation: string, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    await interruptible(this.assertGeneration(generation), signal);
    signal.throwIfAborted();
    if (this.revoked) throw new Error("Generator startup was revoked");
  }

  private async request(
    path: string,
    signal: AbortSignal,
    body?: unknown,
  ): Promise<string> {
    return deadline(GENERATOR_DEADLINES.io, signal, async (ioSignal) => {
      ioSignal.throwIfAborted();
      if (this.revoked) throw new Error("Generator startup was revoked");
      // Deliberately do not use containerFetch(): its deferred auto-start path
      // could run after abort/destruction. A TCP-port fetch never starts runtime.
      this.renewActivityTimeout();
      const fetching = this.ctx
        .container!.getTcpPort(8080)
        .fetch(`http://container/${path}`, {
          method: body === undefined ? "GET" : "POST",
          headers: { "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: ioSignal,
        });
      void fetching.then(
        (response) => {
          if (ioSignal.aborted) void response.body?.cancel().catch(() => {});
        },
        () => {},
      );
      const response = await interruptible(fetching, ioSignal);
      const text = await agentBody(response, ioSignal);
      ioSignal.throwIfAborted();
      if (!response.ok) throw new Error(`Generator ${path} failed: ${text}`);
      return text;
    });
  }

  async prepare(
    config: AgentPrepareRequest,
    generation: string,
  ): Promise<AgentPrepareResponse> {
    return this.guarded(GENERATOR_DEADLINES.prepare, async (signal) => {
      if (
        !generation ||
        this.revoked ||
        (await interruptible(this.ctx.storage.get("revoked"), signal))
      )
        throw new Error("Generator startup was revoked");
      const existing = await interruptible(
        this.ctx.storage.get<string>("generation"),
        signal,
      );
      if (existing && existing !== generation)
        throw new Error("Generator generation mismatch");
      await interruptible(
        this.ctx.storage.put("generation", generation),
        signal,
      );
      const targetHost = new URL(config.targetOrigin).hostname;
      const callbackHost = new URL(config.callbackUrl).hostname;
      await this.check(generation, signal);
      await interruptible(
        this.setAllowedHosts([...new Set([targetHost, callbackHost])]),
        signal,
      );
      await this.check(generation, signal);
      await interruptible(
        this.setDeniedHosts([
          "0.0.0.0",
          "127.0.0.1",
          "localhost",
          "169.254.169.254",
          "metadata.google.internal",
        ]),
        signal,
      );
      await this.check(generation, signal);
      const starting = this.startAndWaitForPorts({
        ports: 8080,
        startOptions: {
          enableInternet: false,
          envVars: {
            PORT: "8080",
            SSL_CERT_FILE: "/etc/cloudflare/certs/cloudflare-containers-ca.crt",
          },
          labels: { run: config.runId, assignment: config.assignmentId },
        },
        cancellationOptions: {
          abort: signal,
          instanceGetTimeoutMS: 15_000,
          portReadyTimeoutMS: 30_000,
          waitInterval: 250,
        },
      });
      this.starts.add(starting);
      void starting.then(
        () => this.starts.delete(starting),
        () => this.starts.delete(starting),
      );
      await interruptible(starting, signal);
      await this.check(generation, signal);
      const text = await this.request("prepare", signal, config);
      await this.check(generation, signal);
      return JSON.parse(text) as AgentPrepareResponse;
    });
  }

  async launch(startAt: string, generation: string): Promise<void> {
    return this.guarded(GENERATOR_DEADLINES.io, async (signal) => {
      await this.check(generation, signal);
      await this.request("start", signal, { startAt });
      await this.check(generation, signal);
    });
  }

  async stopRun(): Promise<void> {
    // Unlike stop(), destroy() resolves only after runtime-confirmed destruction.
    // Do not fetch /stop: that can wake an already sleeping Container.
    // Revoke synchronously, including requests queued before the storage write.
    // Interrupt HTTP/body waits instead of queuing destruction behind them.
    this.revoked = true;
    for (const controller of this.active)
      controller.abort(new Error("Generator startup was revoked"));
    this.teardown ??= deadline(
      GENERATOR_DEADLINES.destroy,
      undefined,
      async (signal) => {
        await interruptible(this.ctx.storage.put("revoked", true), signal);
        // An SDK start ignored by abort may still issue a runtime start later.
        // Never acknowledge destruction until every such continuation has settled.
        await interruptible(Promise.allSettled(this.starts), signal);
        signal.throwIfAborted();
        if (!this.destruction) {
          const destroying = this.destroy();
          this.destruction = destroying;
          void destroying.then(
            () => {
              if (this.destruction === destroying) this.destruction = undefined;
            },
            () => {
              if (this.destruction === destroying) this.destruction = undefined;
            },
          );
        }
        await interruptible(this.destruction, signal);
      },
    ).finally(() => {
      this.teardown = undefined;
    });
    await this.teardown;
  }

  async runStatus(): Promise<unknown> {
    return this.guarded(GENERATOR_DEADLINES.io, async (signal) => {
      const generation = await interruptible(
        this.ctx.storage.get<string>("generation"),
        signal,
      );
      await this.check(generation ?? "", signal);
      return JSON.parse(await this.request("status", signal));
    });
  }
}

export class GeneratorENAM extends LoadGenerator {}
export class GeneratorWNAM extends LoadGenerator {}
export class GeneratorWEUR extends LoadGenerator {}
export class GeneratorEEUR extends LoadGenerator {}
export class GeneratorAPAC extends LoadGenerator {}
export class GeneratorSAM extends LoadGenerator {}
