import { z } from "zod";
import { extractAndParseJson, extractJsonText, formatZodIssues } from "../src/internal/json";

describe("internal/json", () => {
  describe("extractJsonText", () => {
    test("finds first complete JSON object", () => {
      const text = "Hello! {\"a\": 1, \"b\": [2,3]} Thanks";
      expect(extractJsonText(text)).toBe('{"a": 1, "b": [2,3]}');
    });

    test("finds first complete JSON array", () => {
      const text = "prefix [1,2,{\"x\":true}] suffix";
      expect(extractJsonText(text)).toBe('[1,2,{"x":true}]');
    });
  });

  describe("extractAndParseJson", () => {
    test("returns no_json when none present", () => {
      const res = extractAndParseJson("just text");
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.reason).toBe("no_json");
      }
    });

    test("returns invalid_json on parse failure", () => {
      const res = extractAndParseJson("{\"a\": 1,}");
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.reason).toBe("invalid_json");
        expect(res.jsonText).toBe('{"a": 1,}');
      }
    });
  });

  describe("formatZodIssues", () => {
    test("formats issue paths", () => {
      const schema = z.object({ a: z.object({ b: z.number() }) });
      const parsed = schema.safeParse({ a: { b: "nope" } });
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        const s = formatZodIssues(parsed.error);
        expect(s).toContain("- a.b:");
      }
    });
  });
});
