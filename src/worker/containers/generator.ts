import { Container } from "@cloudflare/containers";
import type {
  AgentPrepareRequest,
  AgentPrepareResponse,
} from "../../shared/api";
import type { Env } from "../env";

class LoadGenerator extends Container<Env> {
  defaultPort = 8080;
  requiredPorts = [8080];
  pingEndpoint = "container/health";
  sleepAfter = "45s";
  enableInternet = false;
  interceptHttps = true;

  async prepare(config: AgentPrepareRequest): Promise<AgentPrepareResponse> {
    const targetHost = new URL(config.targetOrigin).hostname;
    const callbackHost = new URL(config.callbackUrl).hostname;
    await this.setAllowedHosts([...new Set([targetHost, callbackHost])]);
    await this.setDeniedHosts([
      "0.0.0.0",
      "127.0.0.1",
      "localhost",
      "169.254.169.254",
      "metadata.google.internal",
    ]);
    await this.startAndWaitForPorts({
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
        instanceGetTimeoutMS: 15_000,
        portReadyTimeoutMS: 30_000,
        waitInterval: 250,
      },
    });
    const response = await this.containerFetch("http://container/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    if (!response.ok)
      throw new Error(`Generator prepare failed: ${await response.text()}`);
    return (await response.json()) as AgentPrepareResponse;
  }

  async launch(startAt: string): Promise<void> {
    const response = await this.containerFetch("http://container/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startAt }),
    });
    if (!response.ok)
      throw new Error(`Generator start failed: ${await response.text()}`);
  }

  async stopRun(): Promise<void> {
    try {
      await this.containerFetch("http://container/stop", { method: "POST" });
    } finally {
      await this.stop("SIGTERM");
    }
  }

  async runStatus(): Promise<unknown> {
    const response = await this.containerFetch("http://container/status");
    return response.json();
  }
}

export class GeneratorENAM extends LoadGenerator {}
export class GeneratorWNAM extends LoadGenerator {}
export class GeneratorWEUR extends LoadGenerator {}
export class GeneratorEEUR extends LoadGenerator {}
export class GeneratorAPAC extends LoadGenerator {}
export class GeneratorSAM extends LoadGenerator {}
