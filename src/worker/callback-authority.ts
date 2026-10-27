import type { Env } from "./env";
import { HttpError } from "./http";

export async function callbackHash(token: string): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** Reject unknown IDs and invalid callback authority before per-run DO activation. */
export async function authorizeCallback(
  request: Request,
  env: Env,
  runId: unknown,
  assignmentId: unknown,
  token: unknown,
): Promise<void> {
  if (
    typeof runId !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9-]{27}$/.test(runId) ||
    typeof assignmentId !== "string" ||
    assignmentId.length > 100 ||
    typeof token !== "string" ||
    token.length < 32 ||
    token.length > 256
  )
    throw new HttpError(403, "Callback was rejected");
  if (!env.CALLBACK_RATE_LIMITER)
    throw new HttpError(503, "Callback admission is unavailable");
  if (
    !(
      await env.CALLBACK_RATE_LIMITER.limit({
        key: `callback:${request.headers.get("CF-Connecting-IP") || "unknown"}`,
      })
    ).success ||
    !(
      await env.CALLBACK_RATE_LIMITER.limit({ key: "callback-authority-reads" })
    ).success
  )
    throw new HttpError(429, "Callback rate limit reached");
  const row = await env.LOADLAB_DB.prepare(
    "SELECT 1 FROM run_callback_authority WHERE run_id = ? AND assignment_id = ? AND token_hash = ? AND expires_at > ?",
  )
    .bind(runId, assignmentId, await callbackHash(token), Date.now())
    .first();
  if (!row) throw new HttpError(403, "Callback was rejected");
}
