export function gardenUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      !/(^|\.)cloudflare\.com$/.test(url.hostname)
    )
      return raw;
    const parts = url.pathname.split("/").filter(Boolean);
    url.searchParams.set("utm_source", "gryczka.dev");
    url.searchParams.set("utm_medium", "referral");
    url.searchParams.set("utm_campaign", "app-garden");
    url.searchParams.set(
      "utm_content",
      `load-lab-${parts.join("-") || "overview"}`,
    );
    url.searchParams.set(
      "utm_term",
      parts.includes("network") ? "cloudflare-network" : "containers",
    );
    return url.href;
  } catch {
    return raw;
  }
}
