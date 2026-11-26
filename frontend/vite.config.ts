import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      workbox: {
        globPatterns: ["**/*.{js,css,html,mjs,woff2}"],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024
      },
      manifest: {
        name: "StokvelLedger — Zero-Custody SA Ledger",
        short_name: "StokvelLedger",
        theme_color: "#0A1120",
        background_color: "#0A1120",
        display: "standalone"
      }
    })
  ],
  worker: { format: "es" }
});
