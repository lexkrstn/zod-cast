import type { ZodError, ZodIssue } from "zod";

export type JsonExtractionResult =
  | {
      ok: true;
      jsonText: string;
      value: unknown;
    }
  | {
      ok: false;
      reason: "no_json" | "invalid_json";
      message: string;
      jsonText?: string;
    };

export function extractJsonText(text: string): string | null {
  const start = findJsonStartIndex(text);
  if (start == null) return null;

  let inString = false;
  let escaped = false;
  let depth = 0;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "{" || ch === "[") {
      depth++;
      continue;
    }

    if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}

function findJsonStartIndex(text: string): number | null {
  const obj = text.indexOf("{");
  const arr = text.indexOf("[");

  if (obj === -1 && arr === -1) return null;
  if (obj === -1) return arr;
  if (arr === -1) return obj;
  return Math.min(obj, arr);
}

export function extractAndParseJson(text: string): JsonExtractionResult {
  const jsonText = extractJsonText(text);
  if (!jsonText) {
    return {
      ok: false,
      reason: "no_json",
      message: "No JSON object/array found in model output."
    };
  }

  try {
    const value = JSON.parse(jsonText) as unknown;
    return { ok: true, jsonText, value };
  } catch (err) {
    return {
      ok: false,
      reason: "invalid_json",
      message: err instanceof Error ? err.message : String(err),
      jsonText
    };
  }
}

export function formatZodIssues(error: ZodError): string {
  const lines = error.issues.map((issue: ZodIssue) => {
    const path = issue.path.length ? issue.path.join(".") : "<root>";
    return `- ${path}: ${issue.message}`;
  });
  return lines.join("\n");
}
