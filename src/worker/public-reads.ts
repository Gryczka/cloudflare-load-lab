import type { Env } from "./env";
import { HttpError, isAdmin } from "./http";

/** Cache only anonymous, server-sanitized demo reads; never administrator responses. */
export async function publicRead(
  request: Request,
  env: Env,
  ttl: number,
  load: () => Promise<Response>,
): Promise<Response> {
  if (request.headers.has("Authorization")) {
    if (!isAdmin(request, env))
      throw new HttpError(401, "Invalid administrator authority");
    const response = await load();
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
  const url = new URL(request.url);
  url.search = "";
  url.pathname = `/_garden-cache/v1${url.pathname}`;
  const key = new Request(url, { method: "GET" });
  const cache = (caches as CacheStorage & { default: Cache }).default;
  const cached = await cache.match(key);
  if (cached) return cached;
  if (!env.PUBLIC_READ_LIMITER)
    throw new HttpError(503, "Public read admission is unavailable");
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (
    !(await env.PUBLIC_READ_LIMITER.limit({ key: `read:${ip}` })).success ||
    !(await env.PUBLIC_READ_LIMITER.limit({ key: "public-read-misses" }))
      .success
  )
    throw new HttpError(429, "Public read rate limit reached");
  const response = await load();
  if (response.ok) {
    response.headers.set(
      "Cache-Control",
      `public, max-age=${ttl}, s-maxage=${ttl}`,
    );
    await cache.put(key, response.clone());
  }
  return response;
}
