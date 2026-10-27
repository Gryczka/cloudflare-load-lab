import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { authorizeCallback, callbackHash } from "./callback-authority";
import type { Env } from "./env";
import { RunCoordinator } from "./durable-objects/run-coordinator";
import { DEMO_RUN_CONFIG } from "../shared/types";

it("checks callback hashes, assignment identity and expiry against the actual migration", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(
      readFileSync(
        new URL(
          "../../migrations/0003_callback_authority.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const runId = "12345678-1234-1234-1234-123456789abc";
    const assignmentId = `${runId}-enam-0`;
    const token = "mock-only-callback-token-1234567890";
    db.prepare("INSERT INTO run_callback_authority VALUES (?, ?, ?, ?)").run(
      runId,
      assignmentId,
      await callbackHash(token),
      Date.now() + 60_000,
    );
    const env = {
      CALLBACK_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
      LOADLAB_DB: {
        prepare(query: string) {
          let args: SQLInputValue[] = [];
          return {
            bind(...values: SQLInputValue[]) {
              args = values;
              return this;
            },
            first: async () => db.prepare(query).get(...args),
          };
        },
      },
    } as unknown as Env;
    const request = new Request("https://load.example/api/internal/complete");
    await expect(
      authorizeCallback(request, env, runId, assignmentId, token),
    ).resolves.toBeUndefined();
    await expect(
      authorizeCallback(request, env, runId, assignmentId, "x".repeat(36)),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      authorizeCallback(request, env, runId, `${runId}-weur-0`, token),
    ).rejects.toMatchObject({ status: 403 });
    db.prepare("UPDATE run_callback_authority SET expires_at = 0").run();
    await expect(
      authorizeCallback(request, env, runId, assignmentId, token),
    ).rejects.toMatchObject({ status: 403 });
  } finally {
    db.close();
  }
});

it("authorizes only the callbacks written by coordinator initialization through the migration", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(
      readFileSync(
        new URL(
          "../../migrations/0003_callback_authority.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const data = new Map<string, unknown>();
    let ready!: Promise<void>;
    const ctx = {
      blockConcurrencyWhile: (callback: () => Promise<void>) => {
        ready = callback();
      },
      storage: {
        get: async (key: string) => data.get(key),
        put: async (key: string, value: unknown) => {
          data.set(key, structuredClone(value));
        },
        setAlarm: async () => {},
      },
    } as unknown as DurableObjectState;
    const environment = {
      CALLBACK_RATE_LIMITER: { limit: async () => ({ success: true }) },
      LOADLAB_DB: {
        prepare(query: string) {
          let args: SQLInputValue[] = [];
          return {
            bind(...values: SQLInputValue[]) {
              args = values;
              return this;
            },
            first: async () => db.prepare(query).get(...args),
            run: async () => db.prepare(query).run(...args),
          };
        },
        batch: async (statements: { run: () => Promise<unknown> }[]) =>
          Promise.all(statements.map((statement) => statement.run())),
      },
    } as unknown as Env;
    const coordinator = new RunCoordinator(ctx, environment);
    await ready;
    const runId = "12345678-1234-1234-1234-123456789abc";
    await coordinator.initialize({
      id: runId,
      config: structuredClone(DEMO_RUN_CONFIG),
      targetOrigin: "https://target.example",
      callbackBaseUrl: "https://load.example",
      isDemo: true,
    });
    const stored = data.get("run") as {
      assignments: { id: string; token: string }[];
    };
    const request = new Request("https://load.example/api/internal/complete");
    for (const assignment of stored.assignments) {
      await expect(
        authorizeCallback(
          request,
          environment,
          runId,
          assignment.id,
          assignment.token,
        ),
      ).resolves.toBeUndefined();
      await expect(
        authorizeCallback(
          request,
          environment,
          runId,
          assignment.id,
          "x".repeat(36),
        ),
      ).rejects.toMatchObject({ status: 403 });
    }
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM run_callback_authority").get(),
    ).toMatchObject({ count: stored.assignments.length });
  } finally {
    db.close();
  }
});
