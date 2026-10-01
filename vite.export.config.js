// Build config for the static-export viewer template.
//
// Produces public/export-template.html as ONE self-contained file (JS + CSS
// inlined, no network dependencies) via vite-plugin-singlefile. The main
// `vite build` then copies it into dist/, and `vite dev` serves it from
// public/ — either way the app fetches it at runtime, injects the dashboard
// payload, and downloads the result.
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  plugins: [viteSingleFile()],
  publicDir: false, // don't copy public/ into itself
  build: {
    outDir: "public",
    emptyOutDir: false, // never wipe public/
    assetsInlineLimit: 100 * 1024 * 1024,
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      input: "export-template.html"
    }
  }
});
