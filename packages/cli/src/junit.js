import fs from "node:fs/promises";

export async function writeJUnit(filename, run) {
  const duration =
    run.startedAt && run.completedAt
      ? Math.max(
          0,
          (new Date(run.completedAt) - new Date(run.startedAt)) / 1_000,
        )
      : 0;
  const failures = run.status === "passed" ? 0 : 1;
  const failure = failures
    ? `\n    <failure message="${escapeXML(failureMessage(run))}">${escapeXML(JSON.stringify({ status: run.status, thresholds: run.thresholds, error: run.error }, null, 2))}</failure>`
    : "";
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="Cloudflare Load Lab" tests="1" failures="${failures}" time="${duration.toFixed(3)}">
  <testsuite name="${escapeXML(run.config.name)}" tests="1" failures="${failures}" time="${duration.toFixed(3)}">
    <testcase classname="loadlab.global" name="thresholds" time="${duration.toFixed(3)}">${failure}
    </testcase>
    <system-out>${escapeXML(JSON.stringify({ runId: run.id, requests: run.totals.requests, p95Ms: run.thresholds.p95Ms, errorRate: run.thresholds.errorRate }))}</system-out>
  </testsuite>
</testsuites>
`;
  await fs.writeFile(filename, xml);
}

function failureMessage(run) {
  if (run.error) return run.error;
  if (!run.thresholds.checks.latency)
    return `p95 ${run.thresholds.p95Ms}ms exceeded the configured threshold`;
  if (!run.thresholds.checks.errors)
    return `error rate ${(run.thresholds.errorRate * 100).toFixed(2)}% exceeded the configured threshold`;
  return `run ended with status ${run.status}`;
}

function escapeXML(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
