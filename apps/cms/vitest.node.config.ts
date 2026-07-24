import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/seeds.test.ts"],
    environment: "node",
  },
});
