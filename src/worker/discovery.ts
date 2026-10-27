import { gardenUrl } from "../shared/garden";

const origin = "https://cloudflare-load-lab.dwarven.workers.dev";
const pages: Record<string, { title: string; description: string }> = {
  "/": {
    title: "Load Lab · Cloudflare Containers",
    description:
      "Explore synchronized global load testing with bounded public demos and verified custom targets.",
  },
  "/architecture": {
    title: "Load Lab architecture · Workers, Containers, D1 and R2",
    description:
      "Learn how regional Containers, Durable Objects, D1, and R2 coordinate exact allocation, histogram merging, and confirmed teardown.",
  },
  "/preview": {
    title: "Load Lab sample results · No execution required",
    description:
      "Explore sample global load-test results and regional placement without starting generators.",
  },
};

/** Serve useful route-specific HTML before hydration, without allocating state. */
export function discoverableAsset(response: Response, path: string): Response {
  if (!response.headers.get("content-type")?.includes("text/html"))
    return response;
  const page = pages[path];
  const result = new Response(response.body, response);
  if (!page) {
    result.headers.set("X-Robots-Tag", "noindex, nofollow");
    return result;
  }
  result.headers.set("Cache-Control", "public, max-age=300");
  return new HTMLRewriter()
    .on("title", {
      element(element) {
        element.setInnerContent(page.title);
      },
    })
    .on('meta[name="description"]', {
      element(element) {
        element.setAttribute("content", page.description);
      },
    })
    .on('link[rel="canonical"]', {
      element(element) {
        element.setAttribute("href", `${origin}${path}`);
      },
    })
    .on("#root h1", {
      element(element) {
        element.setInnerContent(page.title);
      },
    })
    .on("#root p:first-of-type", {
      element(element) {
        element.setInnerContent(page.description);
      },
    })
    .on("a[href]", {
      element(element) {
        element.setAttribute("href", gardenUrl(element.getAttribute("href")!));
      },
    })
    .transform(result);
}
