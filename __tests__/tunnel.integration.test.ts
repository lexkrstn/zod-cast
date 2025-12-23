import { z } from "zod";
import { createTunnel, TunnelMaxRetriesError } from "../src/index";

describe("createTunnel integration", () => {
  describe("successful extraction", () => {
    test("succeeds on first attempt when valid JSON matches schema", async () => {
      const schema = z.object({ name: z.string(), age: z.number() });
      const tunnel = createTunnel(schema, { maxRetries: 2, systemPrompt: "You are a data extractor." });

      const result = await tunnel.run(async ({ injectSchema, context }) => {
        const prompt = injectSchema("Extract user");
        expect(typeof prompt).toBe("string");
        expect(context.attempt).toBe(0);
        expect(context.maxRetries).toBe(2);
        expect(context.lastFailure).toBeNull();
        return '{"name":"Ada","age":42}';
      });

      expect(result).toEqual({ name: "Ada", age: 42 });
    });

    test("parses complex nested schemas", async () => {
      const schema = z.object({
        user: z.object({
          name: z.string(),
          metadata: z.object({ id: z.number() })
        }),
        tags: z.array(z.string())
      });
      const tunnel = createTunnel(schema);

      const result = await tunnel.run(async ({ injectSchema }) => {
        injectSchema("Extract data");
        return '{"user":{"name":"Bob","metadata":{"id":123}},"tags":["a","b"]}';
      });

      expect(result.user.name).toBe("Bob");
      expect(result.user.metadata.id).toBe(123);
      expect(result.tags).toEqual(["a", "b"]);
    });
  });

  describe("retry mechanism", () => {
    test("retries when missing required fields and succeeds", async () => {
      const schema = z.object({ name: z.string(), age: z.number() });
      const tunnel = createTunnel(schema, { maxRetries: 2 });

      const calls: string[] = [];
      const result = await tunnel.run(async ({ injectSchema, context }) => {
        const prompt = injectSchema("Extract user");
        calls.push(prompt);
        if (context.attempt === 0) return '{"name":"Ada"}';
        return '{"name":"Ada","age":42}';
      });

      expect(result.age).toBe(42);
      expect(calls.length).toBe(2);
      expect(calls[1]).toContain("Your previous response was invalid");
      expect(calls[1]).toContain("Schema issues:");
    });

    test("retries when JSON is invalid and succeeds", async () => {
      const schema = z.object({ value: z.number() });
      const tunnel = createTunnel(schema, { maxRetries: 2 });

      const attempts: number[] = [];
      const result = await tunnel.run(async ({ injectSchema, context }) => {
        injectSchema("Get value");
        attempts.push(context.attempt);
        if (context.attempt === 0) return '{"value": invalid}';
        return '{"value": 99}';
      });

      expect(result.value).toBe(99);
      expect(attempts).toEqual([0, 1]);
    });

    test("provides lastFailure context on retry attempts", async () => {
      const schema = z.object({ x: z.number() });
      const tunnel = createTunnel(schema, { maxRetries: 1 });

      await tunnel.run(async ({ injectSchema, context }) => {
        injectSchema("Extract");
        if (context.attempt === 0) {
          expect(context.lastFailure).toBeNull();
          return '{"x": "not a number"}';
        }
        expect(context.lastFailure).not.toBeNull();
        expect(context.lastFailure?.type).toBe("schema");
        return '{"x": 42}';
      });
    });
  });

  describe("prompt injection and schema handling", () => {
    test("injectSchema includes schema definition in prompt", async () => {
      const schema = z.object({ foo: z.string() });
      const tunnel = createTunnel(schema, { schemaName: "MyOutput" });

      await tunnel.run(async ({ injectSchema }) => {
        const prompt = injectSchema("Test prompt");
        expect(prompt).toContain("MyOutput");
        expect(prompt).toContain("foo");
        expect(prompt).toContain("Test prompt");
        expect(prompt).toContain("JSON.parse()");
        return '{"foo":"bar"}';
      });
    });

    test("injectSchema includes systemPrompt when provided", async () => {
      const schema = z.object({ data: z.string() });
      const tunnel = createTunnel(schema, { systemPrompt: "You are a helpful assistant." });

      await tunnel.run(async ({ injectSchema }) => {
        const prompt = injectSchema("Extract");
        expect(prompt).toContain("You are a helpful assistant.");
        return '{"data":"test"}';
      });
    });

    test("locks original prompt intent across retries", async () => {
      const schema = z.object({ val: z.number() });
      const tunnel = createTunnel(schema, { maxRetries: 2 });

      const prompts: string[] = [];
      await tunnel.run(async ({ injectSchema, context }) => {
        const prompt = injectSchema(context.attempt === 0 ? "First intent" : "Different intent");
        prompts.push(prompt);
        if (context.attempt === 0) return '{"val": "bad"}';
        return '{"val": 10}';
      });

      expect(prompts[0]).toContain("First intent");
      expect(prompts[1]).toContain("First intent");
      expect(prompts[1]).not.toContain("Different intent");
    });

    test("handles empty user prompt gracefully", async () => {
      const schema = z.object({ ok: z.boolean() });
      const tunnel = createTunnel(schema);

      const result = await tunnel.run(async ({ injectSchema }) => {
        const prompt = injectSchema("");
        expect(prompt).toContain("JSON.parse()");
        return '{"ok":true}';
      });

      expect(result.ok).toBe(true);
    });
  });

  describe("error handling", () => {
    test("throws TunnelMaxRetriesError after exhausting retries", async () => {
      const schema = z.object({ ok: z.literal(true) });
      const tunnel = createTunnel(schema, { maxRetries: 1 });

      await expect(
        tunnel.run(async ({ injectSchema }) => {
          injectSchema("Get ok");
          return "not json";
        })
      ).rejects.toBeInstanceOf(TunnelMaxRetriesError);
    });

    test("TunnelMaxRetriesError contains all failure details", async () => {
      const schema = z.object({ ok: z.literal(true) });
      const tunnel = createTunnel(schema, { maxRetries: 1 });

      try {
        await tunnel.run(async ({ injectSchema }) => {
          injectSchema("Test");
          return "not json";
        });
        fail("Should have thrown");
      } catch (e) {
        const err = e as TunnelMaxRetriesError;
        expect(err.failures.length).toBe(2);
        expect(err.failures[0].type).toBe("no_json");
        expect(err.failures[0].raw).toBe("not json");
        expect(err.message).toContain("Failed to produce valid output");
      }
    });

    test("handles invalid_json failure type", async () => {
      const schema = z.object({ x: z.number() });
      const tunnel = createTunnel(schema, { maxRetries: 0 });

      try {
        await tunnel.run(async ({ injectSchema }) => {
          injectSchema("Extract");
          return '{"x": 1,}';
        });
        fail("Should have thrown");
      } catch (e) {
        const err = e as TunnelMaxRetriesError;
        expect(err.failures[0].type).toBe("invalid_json");
      }
    });

    test("handles schema validation failure type", async () => {
      const schema = z.object({ num: z.number() });
      const tunnel = createTunnel(schema, { maxRetries: 0 });

      try {
        await tunnel.run(async ({ injectSchema }) => {
          injectSchema("Extract");
          return '{"num":"not a number"}';
        });
        fail("Should have thrown");
      } catch (e) {
        const err = e as TunnelMaxRetriesError;
        expect(err.failures[0].type).toBe("schema");
        if (err.failures[0].type === "schema") {
          expect(err.failures[0].issues).toContain("num");
        }
      }
    });
  });

  describe("configuration options", () => {
    test("respects custom maxRetries setting", async () => {
      const schema = z.object({ val: z.number() });
      const tunnel = createTunnel(schema, { maxRetries: 5 });

      let attemptCount = 0;
      await tunnel.run(async ({ injectSchema, context }) => {
        injectSchema("Get val");
        attemptCount = context.attempt;
        expect(context.maxRetries).toBe(5);
        if (context.attempt < 3) return "bad";
        return '{"val":1}';
      });

      expect(attemptCount).toBe(3);
    });

    test("uses default maxRetries when not specified", async () => {
      const schema = z.object({ x: z.number() });
      const tunnel = createTunnel(schema);

      await tunnel.run(async ({ context }) => {
        expect(context.maxRetries).toBe(2);
        return '{"x":1}';
      });
    });

    test("truncates large failure output based on maxFailureOutputChars", async () => {
      const schema = z.object({ ok: z.boolean() });
      const tunnel = createTunnel(schema, { maxRetries: 1, maxFailureOutputChars: 10 });

      const prompts: string[] = [];
      await tunnel.run(async ({ injectSchema, context }) => {
        const prompt = injectSchema("Test");
        prompts.push(prompt);
        if (context.attempt === 0) return "x".repeat(1000);
        return '{"ok":true}';
      });

      expect(prompts[1]).toContain("<truncated>");
      expect(prompts[1]).not.toContain("x".repeat(1000));
    });
  });
});
