export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export function json(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(value), { ...init, headers });
}

export async function readJson<T>(
  request: Request,
  maxBytes = 256_000,
): Promise<T> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > maxBytes) throw new HttpError(413, "Request body is too large");
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > maxBytes) {
    throw new HttpError(413, "Request body is too large");
  }
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new HttpError(400, "Request body must be valid JSON");
  }
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return json(
      { error: error.message, details: error.details },
      { status: error.status },
    );
  }
  console.error(error);
  return json({ error: "Internal server error" }, { status: 500 });
}

export function withSecurityHeaders(response: Response): Response {
  const result = new Response(response.body, response);
  result.headers.set("X-Content-Type-Options", "nosniff");
  result.headers.set("X-Frame-Options", "DENY");
  result.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  result.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  result.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; connect-src 'self' wss:; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  );
  return result;
}

export function bearerToken(request: Request): string | undefined {
  const value = request.headers.get("authorization");
  return value?.startsWith("Bearer ") ? value.slice(7) : undefined;
}

export function isAdmin(request: Request, env: Env): boolean {
  if (!env.ADMIN_TOKEN) return false;
  return constantTimeEqual(bearerToken(request) ?? "", env.ADMIN_TOKEN);
}

function constantTimeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}
