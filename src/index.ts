import type { z } from "zod";
import { extractAndParseJson, formatZodIssues } from "./internal/json";
import { zodSchemaToTypeScript } from "./internal/zod-to-ts";

export type TunnelOptions = {
  maxRetries?: number;
  systemPrompt?: string;
  schemaName?: string;
  maxFailureOutputChars?: number;
};

export type TunnelFailure =
  | {
      type: "no_json";
      message: string;
      raw: string;
    }
  | {
      type: "invalid_json";
      message: string;
      raw: string;
      jsonText?: string;
    }
  | {
      type: "schema";
      message: string;
      raw: string;
      jsonText: string;
      issues: string;
    };

export class TunnelMaxRetriesError extends Error {
  readonly failures: TunnelFailure[];

  constructor(message: string, failures: TunnelFailure[]) {
    super(message);
    this.name = "TunnelMaxRetriesError";
    this.failures = failures;
  }
}

export type TunnelRunContext = {
  attempt: number;
  maxRetries: number;
  lastFailure: TunnelFailure | null;
};

export type TunnelRunHelpers = {
  injectSchema: (userPrompt: string) => string;
  context: TunnelRunContext;
};

export type TunnelRunner = (helpers: TunnelRunHelpers) => Promise<string> | string;

export type Tunnel<TSchema extends z.ZodTypeAny> = {
  schema: TSchema;
  run: (runner: TunnelRunner) => Promise<z.infer<TSchema>>;
};

export function createTunnel<TSchema extends z.ZodTypeAny>(schema: TSchema, options: TunnelOptions = {}): Tunnel<TSchema> {
  const maxRetries = options.maxRetries ?? 2;
  const schemaName = options.schemaName ?? "Output";
  const schemaTs = zodSchemaToTypeScript(schema, { name: schemaName });

  const STRICT_RULES = [
    "Return ONLY a valid JSON value that can be parsed by JSON.parse().",
    "Do not wrap the JSON in Markdown fences.",
    "The JSON MUST conform to this TypeScript definition:",
    "```ts\n" + schemaTs + "\n```"
  ].join("\n");

  function buildBasePrompt(userPrompt: string): string {
    const parts: string[] = [];
    if (options.systemPrompt?.trim()) parts.push(options.systemPrompt.trim());

    parts.push(STRICT_RULES);

    if (userPrompt.trim()) parts.push(userPrompt.trim());
    return parts.join("\n\n");
  }

  function truncate(s: string, max = options.maxFailureOutputChars ?? 4000): string {
    if (s.length <= max) return s;
    return s.slice(0, max) + "\n...<truncated>";
  }

  function buildFixPrompt(userPrompt: string, failure: TunnelFailure): string {
    const parts: string[] = [];
    if (options.systemPrompt?.trim()) parts.push(options.systemPrompt.trim());

    parts.push(
      "Your previous response was invalid.",
      "Return ONLY corrected JSON.",
      STRICT_RULES
    );

    parts.push("Validation problems:\n" + failure.message);

    if (failure.type === "schema") {
      parts.push("Schema issues:\n" + failure.issues);
    }

    if (userPrompt.trim()) {
      parts.push("Original request context:\n" + userPrompt.trim());
    }

    parts.push("Previous output:\n```text\n" + truncate(failure.raw) + "\n```");

    return parts.join("\n\n");
  }

  function failureFromRaw(raw: string): TunnelFailure | null {
    const extracted = extractAndParseJson(raw);
    if (!extracted.ok) {
      return {
        type: extracted.reason,
        message: extracted.message,
        raw,
        jsonText: extracted.jsonText
      } as TunnelFailure;
    }

    const validated = schema.safeParse(extracted.value);
    if (validated.success) return null;

    const issues = formatZodIssues(validated.error);

    return {
      type: "schema",
      message: "Output JSON did not match the schema.",
      raw,
      jsonText: extracted.jsonText,
      issues
    };
  }

  return {
    schema,

    run: async (runner: TunnelRunner) => {
      const failures: TunnelFailure[] = [];
      let lastFailure: TunnelFailure | null = null;
      let originalPromptIntent = "";

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const context: TunnelRunContext = { attempt, maxRetries, lastFailure };
        const injectSchema = (userPrompt: string): string => {
          const trimmed = (userPrompt ?? "").trim();
          if (attempt === 0 && trimmed.length) {
            originalPromptIntent = trimmed;
          }

          const effectivePrompt = attempt === 0 ? trimmed : originalPromptIntent;

          return attempt === 0
            ? buildBasePrompt(effectivePrompt)
            : buildFixPrompt(effectivePrompt, lastFailure!);
        };

        const raw = await runner({ injectSchema, context });
        const failure = failureFromRaw(raw);

        if (!failure) {
          const extracted = extractAndParseJson(raw);
          const validated = schema.parse(extracted.ok ? extracted.value : undefined);
          return validated as z.infer<TSchema>;
        }

        failures.push(failure);
        lastFailure = failure;
      }

      throw new TunnelMaxRetriesError(`Failed to produce valid output after ${maxRetries + 1} attempts.`, failures);
    }
  };
}
