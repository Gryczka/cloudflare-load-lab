import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { writeJUnit } from "./junit.js";

test("writes a failing JUnit testcase", async () => {
  const filename = path.join(
    await fs.mkdtemp(path.join(os.tmpdir(), "loadlab-")),
    "report.xml",
  );
  await writeJUnit(filename, {
    id: "run",
    status: "failed",
    startedAt: "2026-01-01T00:00:00Z",
    completedAt: "2026-01-01T00:00:01Z",
    config: { name: "API & checkout" },
    totals: { requests: 10 },
    thresholds: {
      p95Ms: 750,
      errorRate: 0.1,
      checks: { latency: false, errors: false },
    },
  });
  const xml = await fs.readFile(filename, "utf8");
  assert.match(xml, /failures="1"/);
  assert.match(xml, /API &amp; checkout/);
});
