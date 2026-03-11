import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

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
      "/api": "http://localhost:3847",
      "/ws": {
        target: "ws://localhost:3847",
        ws: true,
      },
    },
  },
});
