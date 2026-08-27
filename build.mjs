// ABOUTME: Build script — bundles the CLI to a single zero-dependency CJS file.
// ABOUTME: Injects an ABOUTME banner so vendored copies satisfy header lints.
import { build } from "esbuild";

await build({
  entryPoints: ["src/cli.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  outfile: "dist/cli.cjs",
  banner: {
    js: "// ABOUTME: precmd bundled CLI — generated from src/ by `yarn build`; do not edit by hand.\n// ABOUTME: Runs as a Claude Code PreToolUse hook that blocks convention-violating commands.",
  },
});
