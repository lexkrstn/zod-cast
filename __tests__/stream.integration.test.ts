import { z } from "zod";
import { createJsonStreamValidator } from "../src/stream";

describe("stream integration", () => {
  test("emits valid once JSON becomes complete", () => {
    const schema = z.object({ a: z.number() });
    const validator = createJsonStreamValidator(schema);

    const r1 = validator.push("hello ");
    expect(r1.status).toBe("no_json_yet");

    const r2 = validator.push('{"a":');
    expect(["no_json_yet", "invalid_json"]).toContain(r2.status);

    const r3 = validator.push(" 1} bye");
    expect(r3.status).toBe("valid");
    if (r3.status === "valid") {
      expect(r3.data).toEqual({ a: 1 });
    }
  });

  test("returns invalid_schema when JSON parses but fails schema", () => {
    const schema = z.object({ a: z.number() });
    const validator = createJsonStreamValidator(schema);

    const r = validator.push('{"a":"nope"}');
    expect(r.status).toBe("invalid_schema");
    if (r.status === "invalid_schema") {
      expect(r.issues).toContain("a");
    }
  });
});
