import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const resolveLocal = (path: string) =>
  fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@bb/plugin-sdk/app",
        replacement: resolveLocal("./test-support/plugin-sdk-app.tsx"),
      },
      {
        find: "@bb/plugin-sdk",
        replacement: resolveLocal("./test-support/plugin-sdk.ts"),
      },
    ],
  },
  test: {
    environment: "node",
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["dist/**", "node_modules/**"],
  },
});
