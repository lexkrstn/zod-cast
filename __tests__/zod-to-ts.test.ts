import { z } from "zod";
import { zodSchemaToTypeScript } from "../src/internal/zod-to-ts";

describe("internal/zod-to-ts", () => {
  test("renders object schema as interface with required + optional", () => {
    const schema = z.object({
      name: z.string(),
      age: z.number().optional(),
      tags: z.array(z.string())
    });

    const ts = zodSchemaToTypeScript(schema, { name: "User" });

    expect(ts).toContain("export interface User");
    expect(ts).toContain("name: string");
    expect(ts).toContain("age?: number");
    expect(ts).toContain("tags: string[]");
  });

  test("renders union", () => {
    const schema = z.union([z.string(), z.number()]);
    const ts = zodSchemaToTypeScript(schema, { name: "Value" });
    expect(ts).toContain("export type Value =");
    expect(ts).toContain("string | number");
  });
});
