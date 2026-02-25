import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Some CI/sandbox environments have broken package export resolution.
      // These aliases keep builds deterministic.
      "lucide-react": path.resolve(__dirname, "./node_modules/lucide-react/dist/esm/lucide-react.js"),
      "date-fns": path.resolve(__dirname, "./node_modules/date-fns/index.js"),
    },
  },
});