import { defineConfig } from "vite";

// Static build: `npm run build` emits dist/ ready for any static host.
// Relative asset URLs so the build also works when hosted under a subpath.
export default defineConfig({
  base: "./",
  // Discover the upload worker's parser before its first use to avoid a dev
  // dependency optimization reload interrupting an in-flight upload.
  optimizeDeps: { include: ["d3-dsv"] }
});
