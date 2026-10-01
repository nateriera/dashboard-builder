import { defineConfig } from "vite";

// Static build: `npm run build` emits dist/ ready for any static host.
// Relative asset URLs so the build also works when hosted under a subpath.
export default defineConfig({
  base: "./"
});
