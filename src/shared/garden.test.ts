import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { gardenUrl } from "./garden";

describe("public discovery contract", () => {
  it("attributes resources without losing query parameters/fragments", () => {
    const url = new URL(
      gardenUrl("https://developers.cloudflare.com/containers/?lang=en#limits"),
    );
    expect(url.searchParams.get("lang")).toBe("en");
    expect(url.hash).toBe("#limits");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      utm_source: "gryczka.dev",
      utm_medium: "referral",
      utm_campaign: "app-garden",
      utm_content: "load-lab-containers",
      utm_term: "containers",
    });
    expect(gardenUrl("https://cloudflare.com.evil.example/")).toBe(
      "https://cloudflare.com.evil.example/",
    );
  });
  it("publishes substantive fallback HTML and a public-only sitemap", () => {
    const html = readFileSync(
      new URL("../../index.html", import.meta.url),
      "utf8",
    );
    const robots = readFileSync(
      new URL("../../public/robots.txt", import.meta.url),
      "utf8",
    );
    const sitemap = readFileSync(
      new URL("../../public/sitemap.xml", import.meta.url),
      "utf8",
    );
    expect(html).toContain("histograms");
    expect(html).toContain('rel="canonical"');
    expect(robots).toContain(
      "Content-Signal: search=yes,ai-input=yes,ai-train=no",
    );
    expect(sitemap).toContain("/architecture</loc>");
    expect(sitemap).not.toContain("/api/runs");
  });
});
