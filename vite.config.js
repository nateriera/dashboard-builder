import { execSync } from "node:child_process";
import { defineConfig } from "vite";

// Build tag shown in the header status area (was a hardcoded branch name
// from the 2f era). Resolved once at build time; falls back to "local" when
// git is unavailable (UI pass 2026-10-09).
let buildTag = "local";
try {
  buildTag = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim() || "local";
} catch {
  /* not a git checkout — keep the fallback */
}

// Static build: `npm run build` emits dist/ ready for any static host.
// Relative asset URLs so the build also works when hosted under a subpath.
export default defineConfig({
  base: "./",
  define: { __BUILD_TAG__: JSON.stringify(buildTag) },
  // Discover the upload worker's parser before its first use to avoid a dev
  // dependency optimization reload interrupting an in-flight upload.
  optimizeDeps: { include: ["d3-dsv"] }
});
