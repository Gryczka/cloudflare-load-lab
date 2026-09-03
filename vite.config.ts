import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), react(), cloudflare()],
  build: { outDir: "dist" },
  server: { port: 5173, allowedHosts: ["host.docker.internal"] },
});
