import type { z } from "zod";
import { extractAndParseJson, formatZodIssues } from "./internal/json";

export type StreamValidationResult<T> =
  | {
      status: "no_json_yet";
      buffer: string;
    }
  | {
      status: "invalid_json";
      buffer: string;
      message: string;
      jsonText?: string;
    }
  | {
      status: "invalid_schema";
      buffer: string;
      message: string;
      issues: string;
      jsonText: string;
    }
  | {
      status: "valid";
      buffer: string;
      data: T;
      jsonText: string;
    };

export type JsonStreamValidator<TSchema extends z.ZodTypeAny> = {
  push: (chunk: string) => StreamValidationResult<z.infer<TSchema>>;
  reset: () => void;
  buffer: () => string;
};

export function createJsonStreamValidator<TSchema extends z.ZodTypeAny>(schema: TSchema): JsonStreamValidator<TSchema> {
  let buf = "";

  return {
    push: (chunk: string) => {
      buf += chunk;

      const extracted = extractAndParseJson(buf);
      if (!extracted.ok) {
        if (extracted.reason === "no_json") {
          return { status: "no_json_yet", buffer: buf };
        }

        return {
          status: "invalid_json",
          buffer: buf,
          message: extracted.message,
          jsonText: extracted.jsonText
        };
      }

      const validated = schema.safeParse(extracted.value);
      if (!validated.success) {
        return {
          status: "invalid_schema",
          buffer: buf,
          message: "Output JSON did not match the schema.",
          issues: formatZodIssues(validated.error),
          jsonText: extracted.jsonText
        };
      }

      return {
        status: "valid",
        buffer: buf,
        data: validated.data as z.infer<TSchema>,
        jsonText: extracted.jsonText
      };
    },

    reset: () => {
      buf = "";
    },

    buffer: () => buf
  };
}

export async function* validateJsonStream<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  chunks: AsyncIterable<string>
): AsyncGenerator<StreamValidationResult<z.infer<TSchema>>, void, void> {
  const validator = createJsonStreamValidator(schema);

  for await (const chunk of chunks) {
    yield validator.push(chunk);
  }
}
