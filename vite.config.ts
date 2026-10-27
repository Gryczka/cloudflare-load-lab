import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    cloudflare(
      process.env.GARDEN_STAGING === "1"
        ? { configPath: "./wrangler.staging.jsonc" }
        : {},
    ),
  ],
  build: { outDir: "dist" },
  server: { port: 5173, allowedHosts: ["host.docker.internal"] },
});
