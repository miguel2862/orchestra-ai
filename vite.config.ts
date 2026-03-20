import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

const API_PORT = process.env.ORCHESTRA_API_PORT || "3847";

export default defineConfig({
  root: "src/ui",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "../../dist-ui",
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@shared": resolve(__dirname, "src/shared"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": `http://localhost:${API_PORT}`,
      "/ws": {
        target: `ws://localhost:${API_PORT}`,
        ws: true,
      },
    },
  },
});
