import { z } from "zod";

export type ZodToTsOptions = {
  name?: string;
};

export function zodSchemaToTypeScript(schema: z.ZodTypeAny, options: ZodToTsOptions = {}): string {
  const name = options.name ?? "Output";
  const body = renderType(schema, 0);

  if (isObjectSchema(schema)) {
    return `export interface ${name} ${body}`;
  }

  return `export type ${name} = ${body};`;
}

function renderType(schema: z.ZodTypeAny, depth: number): string {
  const def = (schema as any)._def as any;
  const kind = def.typeName as string;

  if (kind === z.ZodFirstPartyTypeKind.ZodString) return withDescription("string", schema);
  if (kind === z.ZodFirstPartyTypeKind.ZodNumber) return withDescription("number", schema);
  if (kind === z.ZodFirstPartyTypeKind.ZodBoolean) return withDescription("boolean", schema);
  if (kind === z.ZodFirstPartyTypeKind.ZodBigInt) return withDescription("bigint", schema);
  if (kind === z.ZodFirstPartyTypeKind.ZodDate) return withDescription("string", schema);
  if (kind === z.ZodFirstPartyTypeKind.ZodNull) return "null";
  if (kind === z.ZodFirstPartyTypeKind.ZodUndefined) return "undefined";
  if (kind === z.ZodFirstPartyTypeKind.ZodAny) return "any";
  if (kind === z.ZodFirstPartyTypeKind.ZodUnknown) return "unknown";
  if (kind === z.ZodFirstPartyTypeKind.ZodNever) return "never";

  if (kind === z.ZodFirstPartyTypeKind.ZodLiteral) {
    return JSON.stringify(def.value);
  }

  if (kind === z.ZodFirstPartyTypeKind.ZodEnum) {
    const values = def.values as string[];
    return values.map((v) => JSON.stringify(v)).join(" | ");
  }

  if (kind === z.ZodFirstPartyTypeKind.ZodNativeEnum) {
    const values = Object.values(def.values).filter((v) => typeof v === "string" || typeof v === "number");
    return values.map((v) => JSON.stringify(v)).join(" | ");
  }

  if (kind === z.ZodFirstPartyTypeKind.ZodArray) {
    const inner = renderType(def.type, depth);
    return `${wrapIfUnion(inner)}[]`;
  }

  if (kind === z.ZodFirstPartyTypeKind.ZodTuple) {
    const items = (def.items as z.ZodTypeAny[]).map((item: z.ZodTypeAny) => renderType(item, depth));
    return `[${items.join(", ")}]`;
  }

  if (kind === z.ZodFirstPartyTypeKind.ZodUnion) {
    const opts = (def.options as z.ZodTypeAny[]).map((opt: z.ZodTypeAny) => renderType(opt, depth));
    return opts.join(" | ");
  }

  if (kind === z.ZodFirstPartyTypeKind.ZodDiscriminatedUnion) {
    const opts = Array.from((def.options as Map<string, z.ZodTypeAny>).values()).map((opt) => renderType(opt, depth));
    return opts.join(" | ");
  }

  if (kind === z.ZodFirstPartyTypeKind.ZodIntersection) {
    const left = renderType(def.left, depth);
    const right = renderType(def.right, depth);
    return `${wrapIfUnion(left)} & ${wrapIfUnion(right)}`;
  }

  if (kind === z.ZodFirstPartyTypeKind.ZodOptional) {
    const inner = renderType(def.innerType, depth);
    return `${inner} | undefined`;
  }

  if (kind === z.ZodFirstPartyTypeKind.ZodNullable) {
    const inner = renderType(def.innerType, depth);
    return `${inner} | null`;
  }

  if (kind === z.ZodFirstPartyTypeKind.ZodDefault) {
    return renderType(def.innerType, depth);
  }

  if (kind === z.ZodFirstPartyTypeKind.ZodEffects) {
    return renderType(def.schema, depth);
  }

  if (kind === z.ZodFirstPartyTypeKind.ZodRecord) {
    const key = def.keyType ? renderType(def.keyType, depth) : "string";
    const value = renderType(def.valueType, depth);
    return `Record<${key}, ${value}>`;
  }

  if (kind === z.ZodFirstPartyTypeKind.ZodMap) {
    const key = renderType(def.keyType, depth);
    const value = renderType(def.valueType, depth);
    return `Record<${key}, ${value}>`;
  }

  if (kind === z.ZodFirstPartyTypeKind.ZodObject) {
    const indent = "  ".repeat(depth);
    const indentInner = "  ".repeat(depth + 1);

    const shape: Record<string, z.ZodTypeAny> = def.shape();
    const entries = Object.entries(shape).map(([key, value]) => {
      const optional = isOptional(value);
      const rendered = renderType(unwrapOptionalDefault(value), depth + 1);
      const desc = typeof value.description === "string" && value.description.length ? ` // ${value.description}` : "";
      return `${indentInner}${safeKey(key)}${optional ? "?" : ""}: ${rendered};${desc}`;
    });

    if (entries.length === 0) return `{} `;
    return `{
${entries.join("\n")}
${indent}}`;
  }

  return "unknown";
}

function isObjectSchema(schema: z.ZodTypeAny): boolean {
  const def = (schema as any)._def as any;
  return def?.typeName === z.ZodFirstPartyTypeKind.ZodObject;
}

function isOptional(schema: z.ZodTypeAny): boolean {
  if (typeof (schema as any).isOptional === "function" && (schema as any).isOptional()) return true;
  const def = (schema as any)._def as any;
  return def?.typeName === z.ZodFirstPartyTypeKind.ZodOptional;
}

function unwrapOptionalDefault(schema: z.ZodTypeAny): z.ZodTypeAny {
  let current: any = schema;
  while (true) {
    const def = current?._def;
    if (!def) return current;

    if (def.typeName === z.ZodFirstPartyTypeKind.ZodOptional) {
      current = def.innerType;
      continue;
    }

    if (def.typeName === z.ZodFirstPartyTypeKind.ZodDefault) {
      current = def.innerType;
      continue;
    }

    return current;
  }
}

function wrapIfUnion(t: string): string {
  return t.includes(" | ") ? `(${t})` : t;
}

function safeKey(key: string): string {
  return /^[$A-Z_][0-9A-Z_$]*$/i.test(key) ? key : JSON.stringify(key);
}

function withDescription(type: string, schema: z.ZodTypeAny): string {
  return type;
}
