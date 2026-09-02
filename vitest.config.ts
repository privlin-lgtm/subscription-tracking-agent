import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],
      include: [
        "src/application/**/*.ts",
        "src/domain/**/*.ts",
        "src/shared/**/*.ts",
        "src/infrastructure/gmail/gmail-message-parse.ts",
        "src/infrastructure/gmail/gmail-errors.ts",
        "src/infrastructure/gmail/oauth-state.ts",
        "src/infrastructure/gmail/rate-limit.ts",
        "src/infrastructure/gmail/pkce.ts",
      ],
      exclude: [
        "src/**/*.test.ts",
        "src/test/**",
        "src/application/subscriptions/pipeline.fixtures.ts",
        "src/application/subscriptions/in-memory-subscriptions.ts",
        "src/domain/ports.ts",
        "src/domain/repositories.ts",
        "src/shared/config.ts",
      ],
      thresholds: {
        lines: 90,
        functions: 90,
        statements: 90,
        branches: 80,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
