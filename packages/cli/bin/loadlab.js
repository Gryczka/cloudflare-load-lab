#!/usr/bin/env node
import { LoadLabClient, waitForRun } from "../src/client.js";
import { plan, readConfig } from "../src/config.js";
import { writeJUnit } from "../src/junit.js";

const [command, ...args] = process.argv.slice(2);
const options = parseArgs(args);

try {
  if (!command || command === "help" || options.help) {
    help();
  } else if (command === "plan") {
    const filename = required(options.positionals[0], "configuration file");
    const result = plan(await readConfig(filename));
    console.log(
      `✓ ${result.shards} shard(s) across ${result.regions.join(", ")}`,
    );
    console.log(
      `  ${result.durationSeconds}s run · ${result.generatorSeconds} generator-seconds · peak ${result.peak}`,
    );
  } else {
    const client = new LoadLabClient({
      baseUrl:
        options.api ?? process.env.LOADLAB_API_URL ?? "http://127.0.0.1:5173",
      token: options.token ?? process.env.LOADLAB_TOKEN,
    });
    if (command === "run") {
      const filename = required(options.positionals[0], "configuration file");
      const config = await readConfig(filename);
      const estimate = plan(config);
      console.log(
        `Planning ${estimate.shards} shard(s) for ${estimate.durationSeconds}s…`,
      );
      const run = await client.create(config, options.idempotency);
      console.log(`Run ${run.id} queued: ${client.baseUrl}/runs/${run.id}`);
      if (options.wait) {
        const removeCancellationHandlers = installCancellationHandlers(
          client,
          run.id,
        );
        try {
          const completed = await waitForRun(client, run.id, {
            onUpdate: (value) => {
              process.stdout.write(
                `\r${value.status.padEnd(10)} ${String(value.totals.requests).padStart(8)} requests · p95 ${value.thresholds.p95Ms}ms   `,
              );
            },
          });
          process.stdout.write("\n");
          if (options.junit) {
            await writeJUnit(options.junit, completed);
            console.log(`JUnit report: ${options.junit}`);
          }
          console.log(
            `${completed.status === "passed" ? "✓" : "✗"} ${completed.status} · ${(completed.thresholds.errorRate * 100).toFixed(2)}% errors`,
          );
          process.exitCode =
            completed.status === "passed"
              ? 0
              : completed.status === "failed"
                ? 2
                : 3;
        } finally {
          removeCancellationHandlers();
        }
      }
    } else if (command === "status") {
      const run = await client.get(required(options.positionals[0], "run ID"));
      console.log(JSON.stringify(run, null, options.json ? 2 : 0));
    } else if (command === "stop") {
      const run = await client.stop(required(options.positionals[0], "run ID"));
      console.log(`${run.id}: ${run.status}`);
    } else {
      throw new Error(`Unknown command: ${command}`);
    }
  }
} catch (error) {
  console.error(
    `loadlab: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}

function parseArgs(values) {
  const parsed = { positionals: [] };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--wait") parsed.wait = true;
    else if (value === "--json") parsed.json = true;
    else if (value === "--help" || value === "-h") parsed.help = true;
    else if (value === "--api") parsed.api = values[++index];
    else if (value === "--token") parsed.token = values[++index];
    else if (value === "--junit") parsed.junit = values[++index];
    else if (value === "--idempotency-key")
      parsed.idempotency = values[++index];
    else if (value?.startsWith("-"))
      throw new Error(`Unknown option: ${value}`);
    else parsed.positionals.push(value);
  }
  return parsed;
}

function installCancellationHandlers(client, runId) {
  let cancelling = false;
  const cancel = async (signal, exitCode) => {
    if (cancelling) return;
    cancelling = true;
    process.stderr.write(`\n${signal}: stopping remote run ${runId}…\n`);
    try {
      await client.stop(runId);
      process.stderr.write("Remote run stopped.\n");
    } catch (error) {
      process.stderr.write(
        `Unable to stop remote run: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
    process.exit(exitCode);
  };
  const onInterrupt = () => void cancel("SIGINT", 130);
  const onTerminate = () => void cancel("SIGTERM", 143);
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onTerminate);
  return () => {
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onTerminate);
  };
}

function required(value, label) {
  if (!value) throw new Error(`Missing ${label}`);
  return value;
}

function help() {
  console.log(`Cloudflare Load Lab CLI

Usage:
  loadlab plan <config.yml>
  loadlab run <config.yml> [--wait] [--junit report.xml]
  loadlab status <run-id> [--json]
  loadlab stop <run-id>

Environment:
  LOADLAB_API_URL   Worker deployment URL
  LOADLAB_TOKEN     Administrator Bearer token`);
}
