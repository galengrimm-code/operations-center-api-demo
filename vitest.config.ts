import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: [
      "lib/**/*.test.ts",
      "lib/**/*.test.tsx",
      "supabase/functions/john-deere-import/__tests__/**/*.test.ts",
    ],
    exclude: [
      "node_modules",
      ".next",
      "tests/e2e/**",
      "supabase/functions/john-deere-import/__tests__/import-applications.test.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      exclude: ["**/*.test.ts", "**/*.test.tsx", ".next/**", "tests/e2e/**"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
});
