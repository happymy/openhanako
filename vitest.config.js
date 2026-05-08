import path from "node:path";
import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "desktop/src/react"),
    },
  },
  test: {
    exclude: [
      ...configDefaults.exclude,
      ".cache/**",
      "desktop/native/**/.build/**",
      "dist-computer-use/**",
    ],
    testTimeout: 10_000,
    setupFiles: ["./tests/setup-auto-updater.js"],
    server: {
      deps: {
        inline: ["electron-updater", /desktop\/auto-updater/],
      },
    },
  },
});
