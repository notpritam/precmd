// ABOUTME: Vitest configuration for the precmd test suite.
// ABOUTME: Runs *.test.ts files co-located in src/ under the node environment.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
