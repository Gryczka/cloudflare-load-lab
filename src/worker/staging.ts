import app from "./index";
import { HttpError, readJson } from "./http";
import { publicRead } from "./public-reads";
import type { Env } from "./env";
export { RunCoordinator, BudgetCoordinator } from "./index";

type StageEnv = Env & {
  STAGE_SCOPE: string;
  STAGE_URL: string;
  STAGE_VERSION: { id: string };
};
export default {
  async fetch(request: Request, env: StageEnv): Promise<Response> {
    const url = new URL(request.url);
    let response: Response;
    if (env.STAGE_SCOPE !== "isolated-staging" || url.origin !== env.STAGE_URL)
      response = Response.json(
        { error: "Staging scope is unavailable" },
        { status: 503 },
      );
    else if (url.pathname === "/_stage/metadata" || url.pathname === "/health")
      response = Response.json({
        environmentScope: env.STAGE_SCOPE,
        url: env.STAGE_URL,
        version: env.STAGE_VERSION.id,
        serviceVersion: "0.1.2",
        sourceBaseline: "3d0e9bff0317f3cc4656b96a79f966e2c4e0a21d",
        sourceFix: "generator-abortable-io-fenced-destruction",
        execution: "disabled",
        containers: "unbound",
        sharedProductionBindings: false,
      });
    else if (url.pathname === "/robots.txt")
      response = new Response(
        "User-agent: *\nContent-Signal: search=yes,ai-input=yes,ai-train=no\nDisallow: /\n",
      );
    else if (url.pathname === "/sitemap.xml")
      response = new Response(
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"/>',
        { headers: { "Content-Type": "application/xml" } },
      );
    else if (
      url.pathname === "/_stage/check/body" &&
      request.method === "POST"
    ) {
      try {
        await readJson(request, 4096);
        response = Response.json({
          ok: true,
          fixture: "body-only",
          generatorStarts: 0,
        });
      } catch (error) {
        response = Response.json(
          { error: error instanceof Error ? error.message : "Body rejected" },
          { status: error instanceof HttpError ? error.status : 500 },
        );
      }
    } else if (url.pathname === "/_stage/check/quota") {
      try {
        response = await publicRead(
          request,
          { ...env, PUBLIC_READ_LIMITER: undefined } as unknown as Env,
          1,
          async () => {
            throw new Error("No read may proceed without admission");
          },
        );
      } catch (error) {
        response = Response.json(
          {
            error: error instanceof Error ? error.message : "Admission denied",
          },
          { status: error instanceof HttpError ? error.status : 500 },
        );
      }
    } else if (
      request.method === "GET" ||
      request.method === "HEAD" ||
      (request.method === "POST" &&
        ["/api/internal/metrics", "/api/internal/complete"].includes(
          url.pathname,
        ))
    )
      response = await app.fetch(request, env);
    else
      response = Response.json(
        { error: "Remote generator execution is disabled in staging" },
        { status: 503 },
      );
    response = new Response(response.body, response);
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
    response.headers.set(
      "Content-Signal",
      "search=yes,ai-input=yes,ai-train=no",
    );
    response.headers.set("X-Environment-Scope", "isolated-staging");
    response.headers.set("X-Content-Type-Options", "nosniff");
    if (response.headers.get("content-type")?.includes("text/html"))
      response = new HTMLRewriter()
        .on('link[rel="canonical"]', {
          element(element) {
            element.setAttribute("href", `${env.STAGE_URL}${url.pathname}`);
          },
        })
        .on("head", {
          element(element) {
            element.append(
              '<meta name="robots" content="noindex,nofollow"><meta name="environmentScope" content="isolated-staging">',
              { html: true },
            );
          },
        })
        .on("body", {
          element(element) {
            element.prepend(
              `<aside><strong>ISOLATED STAGING</strong> · ${env.STAGE_URL} · Sample results and reads only; remote generators disabled.</aside>`,
              { html: true },
            );
          },
        })
        .transform(response);
    return request.method === "HEAD" ? new Response(null, response) : response;
  },
} satisfies ExportedHandler<StageEnv>;
