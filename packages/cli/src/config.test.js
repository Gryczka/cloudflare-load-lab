import assert from "node:assert/strict";
import test from "node:test";
import { plan, validateConfig } from "./config.js";

const config = {
  version: 1,
  name: "smoke",
  targetId: "target",
  tasks: [{ name: "health", method: "GET", path: "/health" }],
  profile: {
    mode: "arrival-rate",
    initialTarget: 1,
    maxVus: 10,
    stages: [{ durationSeconds: 10, target: 5 }],
  },
  regions: [
    { code: "ENAM", weight: 50, shards: 1 },
    { code: "WEUR", weight: 50, shards: 2 },
  ],
  thresholds: { p95Ms: 500, errorRate: 0.01 },
};

test("plan returns bounded generator usage", () => {
  assert.deepEqual(plan(config), {
    durationSeconds: 10,
    shards: 3,
    generatorSeconds: 30,
    peak: 5,
    regions: ["ENAM", "WEUR"],
  });
});

test("config rejects protocol-relative task paths", () => {
  assert.throws(
    () => validateConfig({ ...config, tasks: [{ path: "//evil.test" }] }),
    /origin-relative/,
  );
});
