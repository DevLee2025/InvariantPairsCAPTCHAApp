import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  base: "./",
  plugins: [react()],

  server: {
    watch: {
      // Do NOT watch the ~10k local PACS images / manifest under public/. The file
      // watcher over that many files destabilises the dev server on long runs
      // (Windows file-handle pressure → the server dies mid-session). They're still
      // served statically; we just never edit them during play.
      ignored: ["**/public/pacs/**", "**/public/manifest.json"],
    },
    // Multi-annotator Review API (server/app.py). Proxying keeps everything
    // same-origin, so LAN annotators only need the Vite URL (`npm run dev -- --host`).
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
});
