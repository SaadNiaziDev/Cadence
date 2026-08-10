import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    // maplibre-gl is large and only needed once the map mounts, so it is split out of
    // the entry chunk to keep the first paint of the trip form fast.
    rollupOptions: {
      output: {
        manualChunks: {
          maplibre: ["maplibre-gl", "react-map-gl"],
        },
      },
    },
  },
});
