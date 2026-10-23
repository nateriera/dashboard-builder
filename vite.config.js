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
  optimizeDeps: { include: ["d3-dsv"] },
  // Split vendor code out of the app chunk, which was 742 kB at baseline —
  // above Vite's 500 kB chunk-size warning threshold on every build.
  // The Plot bucket is closed under its transitive dependencies (the d3
  // meta-package, interval-tree-1d, isoformat, internmap, delaunator,
  // robust-predicates, iconv-lite, binary-search-bounds): an open bucket
  // makes Rollup report circular chunks and risks module init order.
  // This config is main-app only; the export template keeps its own
  // single-file config (vite.export.config.js).
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (
            id.includes("@observablehq") ||
            id.includes("/d3") ||
            id.includes("topojson-client") ||
            id.includes("/htl/") ||
            id.includes("interval-tree-1d") ||
            id.includes("isoformat") ||
            id.includes("internmap") ||
            id.includes("delaunator") ||
            id.includes("robust-predicates") ||
            id.includes("iconv-lite") ||
            id.includes("binary-search-bounds")
          ) {
            return "vendor-plot";
          }
          return "vendor";
        }
      }
    }
  }
});
