/**
 * Tool parameters in the Gemini `Schema` shape the Antigravity CLI sends as
 * `parameters`: upper-case types, `nullable` instead of null unions, and only
 * the keywords that shape accepts.
 */

const KEPT = new Set([
  "description",
  "title",
  "format",
  "pattern",
  "minItems",
  "maxItems",
  "minLength",
  "maxLength",
  "minProperties",
  "maxProperties",
  "minimum",
  "maximum",
  "default",
  "example",
]);

type Schema = Record<string, unknown>;

const isSchema = (value: unknown): value is Schema =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const describe = (schema: Schema, notes: string[]): Schema => {
  if (notes.length === 0) return schema;
  const description = typeof schema.description === "string" ? schema.description.trim() : "";
  return { ...schema, description: [description, ...notes].filter(Boolean).join(" ") };
};

const mergeAllOf = (schema: Schema): Schema => {
  if (!Array.isArray(schema.allOf)) return schema;
  const { allOf, ...rest } = schema;
  const merged: Schema = { ...rest };
  for (const part of allOf as unknown[]) {
    if (!isSchema(part)) continue;
    const flat = mergeAllOf(part);
    for (const [key, value] of Object.entries(flat)) {
      if (key === "properties" && isSchema(value)) {
        merged.properties = { ...(isSchema(merged.properties) ? merged.properties : {}), ...value };
      } else if (key === "required" && Array.isArray(value)) {
        merged.required = [...new Set([...(Array.isArray(merged.required) ? merged.required : []), ...value])];
      } else if (!(key in merged)) {
        merged[key] = value;
      }
    }
  }
  return merged;
};

export function toGeminiSchema(input: unknown): unknown {
  if (!isSchema(input)) return input;
  const schema = mergeAllOf(input);
  const out: Schema = {};
  const notes: string[] = [];

  let type = schema.type;
  if (Array.isArray(type)) {
    const concrete = type.filter((entry) => entry !== "null");
    if (concrete.length < type.length) out.nullable = true;
    type = concrete.length === 1 ? concrete[0] : undefined;
    if (concrete.length > 1) {
      out.anyOf = concrete.map((entry) => ({ type: String(entry).toUpperCase() }));
    }
  }
  if (schema.nullable === true) out.nullable = true;
  if (typeof type !== "string") {
    type = isSchema(schema.properties) ? "object" : schema.items !== undefined ? "array" : undefined;
  }
  if (typeof type === "string" && type !== "null") out.type = type.toUpperCase();

  for (const [key, value] of Object.entries(schema)) {
    if (KEPT.has(key) && value !== undefined && typeof value !== "object") out[key] = value;
  }

  if ("const" in schema) {
    if (typeof schema.const === "string") {
      out.enum = [schema.const];
      out.type ??= "STRING";
    }
    else notes.push(`Must be ${JSON.stringify(schema.const)}.`);
  }
  if (Array.isArray(schema.enum)) {
    if (schema.enum.every((entry) => typeof entry === "string")) {
      out.enum = schema.enum;
      out.type ??= "STRING";
    }
    else notes.push(`One of: ${schema.enum.map((entry) => JSON.stringify(entry)).join(", ")}.`);
  }
  for (const key of ["exclusiveMinimum", "exclusiveMaximum", "multipleOf"] as const) {
    if (typeof schema[key] === "number") notes.push(`${key}: ${schema[key]}.`);
  }

  const union = (Array.isArray(schema.anyOf) ? schema.anyOf : Array.isArray(schema.oneOf) ? schema.oneOf : undefined) as
    | unknown[]
    | undefined;
  if (union) {
    const variants = union.filter((entry) => !(isSchema(entry) && entry.type === "null"));
    if (variants.length < union.length) out.nullable = true;
    if (variants.length === 1) {
      return describe({ ...(toGeminiSchema(variants[0]) as Schema), ...out }, notes);
    }
    const converted = variants.map(toGeminiSchema) as Schema[];
    const choices = converted.every(
      (variant) => Array.isArray(variant.enum) && (variant.type === undefined || variant.type === "STRING"),
    );
    if (choices) {
      out.type = "STRING";
      out.enum = [...new Set(converted.flatMap((variant) => variant.enum as string[]))];
    } else {
      out.anyOf = converted;
    }
  }

  if (out.type === "OBJECT" || (!out.type && isSchema(schema.properties))) {
    const properties = isSchema(schema.properties) ? schema.properties : {};
    const names = Object.keys(properties);
    if (names.length > 0) {
      out.properties = Object.fromEntries(names.map((name) => [name, toGeminiSchema(properties[name])]));
    }
    if (Array.isArray(schema.required)) {
      const required = schema.required.filter((name) => typeof name === "string" && names.includes(name));
      if (required.length > 0) out.required = required;
    }
  }
  if (out.type === "ARRAY" || (!out.type && schema.items !== undefined)) {
    const items = Array.isArray(schema.items) ? schema.items[0] : schema.items;
    out.items = isSchema(items) ? toGeminiSchema(items) : { type: "STRING" };
  }
  return describe(out, notes);
}
