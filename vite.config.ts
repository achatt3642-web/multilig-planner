import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: process.env.MULTILIG_PUBLIC_BASE ?? "/",
  plugins: [react()],
  server: { port: 4173, strictPort: true },
  preview: { port: 4174, strictPort: true },
  build: { target: "es2022", sourcemap: false },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: { reporter: ["text", "json-summary"] }
  }
});
