import { defineConfig } from "vitest/config";

export default defineConfig({
  root: import.meta.dirname,
  test: {
    environment: "node",
    include: [
      "packages/*/test/**/*.test.{ts,tsx}",
      "tests/package/**/*.test.{ts,tsx}",
    ],
  },
});
