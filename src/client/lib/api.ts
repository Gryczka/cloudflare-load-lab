import type { PublicConfig, RunListItem, RunSnapshot } from "../../shared/api";
import type { RunConfig } from "../../shared/types";

const TOKEN_KEY = "loadlab-admin-token";

export function getAdminToken(): string {
  return sessionStorage.getItem(TOKEN_KEY) ?? "";
}

export function setAdminToken(token: string): void {
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}

function authorizedHeaders(): Headers {
  const headers = new Headers();
  const token = getAdminToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  for (const [name, value] of authorizedHeaders()) headers.set(name, value);
  if (init.body) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...init, headers });
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error(
      "The Load Lab API is unavailable in client-only preview mode",
    );
  }
  const payload = (await response.json().catch(() => ({}))) as T & {
    error?: string;
    details?: unknown;
  };
  if (!response.ok) {
    const detail = payload.details
      ? ` — ${JSON.stringify(payload.details)}`
      : "";
    throw new Error(
      `${payload.error ?? `Request failed (${response.status})`}${detail}`,
    );
  }
  return payload;
}

export const api = {
  config: () => request<PublicConfig>("/api/config"),
  runs: () => request<{ runs: RunListItem[] }>("/api/runs"),
  run: (id: string) => request<RunSnapshot>(`/api/runs/${id}`),
  report: async (id: string) => {
    const response = await fetch(`/api/runs/${id}/report`, {
      headers: authorizedHeaders(),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      throw new Error(
        payload.error ?? `Report download failed (${response.status})`,
      );
    }
    return response.blob();
  },
  startDemo: () =>
    request<RunSnapshot>("/api/runs", {
      method: "POST",
      body: JSON.stringify({ demo: true }),
    }),
  start: (config: RunConfig) =>
    request<RunSnapshot>("/api/runs", {
      method: "POST",
      body: JSON.stringify({ config }),
    }),
  stop: (id: string) =>
    request<RunSnapshot>(`/api/runs/${id}/stop`, { method: "POST" }),
  targets: () =>
    request<{
      targets: Array<{
        id: string;
        origin: string;
        status: string;
        expiresAt?: string;
      }>;
    }>("/api/targets"),
  createTarget: (origin: string) =>
    request<{
      id: string;
      origin: string;
      challenge: string;
      wellKnownUrl: string;
      instructions: string;
    }>("/api/targets", { method: "POST", body: JSON.stringify({ origin }) }),
  verifyTarget: (id: string) =>
    request<{ id: string; origin: string; status: string; expiresAt: string }>(
      `/api/targets/${id}/verify`,
      { method: "POST" },
    ),
};
