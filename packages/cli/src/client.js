export class LoadLabClient {
  constructor({ baseUrl, token, fetchImpl = fetch }) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.token = token;
    this.fetch = fetchImpl;
  }

  async request(path, init = {}) {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    if (init.body) headers.set("Content-Type", "application/json");
    if (this.token) headers.set("Authorization", `Bearer ${this.token}`);
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(
        payload.error ?? `Load Lab returned HTTP ${response.status}`,
      );
    return payload;
  }

  create(config, idempotencyKey) {
    return this.request("/api/runs", {
      method: "POST",
      headers: idempotencyKey
        ? { "Idempotency-Key": idempotencyKey }
        : undefined,
      body: JSON.stringify({ config }),
    });
  }

  get(id) {
    return this.request(`/api/runs/${id}`);
  }

  stop(id) {
    return this.request(`/api/runs/${id}/stop`, { method: "POST" });
  }
}

export const terminalStatuses = new Set([
  "passed",
  "failed",
  "cancelled",
  "error",
]);

export async function waitForRun(
  client,
  id,
  { intervalMs = 1_000, onUpdate = () => {} } = {},
) {
  let previous = "";
  for (;;) {
    const run = await client.get(id);
    const signature = `${run.status}:${run.totals.requests}:${run.assignments.filter((item) => item.status === "running").length}`;
    if (signature !== previous) {
      onUpdate(run);
      previous = signature;
    }
    if (terminalStatuses.has(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
