import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, "artifacts");
await fs.mkdir(output, { recursive: true });

const server = spawn(
  "npm",
  ["run", "dev:client", "--", "--host", "127.0.0.1", "--port", "4174"],
  {
    cwd: root,
    stdio: ["ignore", "pipe", "inherit"],
  },
);

try {
  await waitForServer("http://127.0.0.1:4174/preview");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  await page.goto("http://127.0.0.1:4174/preview", {
    waitUntil: "networkidle",
  });
  await page.screenshot({ path: path.join(output, "cloudflare-load-lab.png") });

  await page.setViewportSize({ width: 1790, height: 1070 });
  await page.goto("http://127.0.0.1:4174/architecture?capture=tile", {
    waitUntil: "networkidle",
  });
  await page.screenshot({
    path: path.join(output, "cloudflare-load-lab-architecture.png"),
  });
  await browser.close();
  console.log(`Captured garden assets in ${output}`);
} finally {
  server.kill("SIGTERM");
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Keep waiting while Vite starts.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for the capture server");
}
