import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const pluginPackageSchema = z.object({
  engines: z.object({
    bb: z.literal(">=0.40 <0.41"),
    bbPluginSdk: z.literal("^0.4.21"),
  }),
  version: z.literal("0.2.0"),
});

describe("Session Fabric compatibility", () => {
  it("declares the BB 0.40 plugin SDK floor", async () => {
    const packageJson: unknown = JSON.parse(
      await readFile(new URL("./package.json", import.meta.url), "utf8"),
    );

    expect(() => pluginPackageSchema.parse(packageJson)).not.toThrow();
  });
});
