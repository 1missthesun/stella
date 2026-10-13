export type ConnectorToolKind = "native" | "mcp" | "api";

export type ConnectorActionSource = {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown> | null;
  annotations?: Record<string, unknown>;
};

export type ConnectorToolSource = {
  id: string;
  name: string;
  kind: ConnectorToolKind;
  actions: readonly ConnectorActionSource[];
  stripPrefixes?: readonly string[];
};

export type ConnectorToolEntry = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  label: string;
  connector: string;
  connectorName: string;
  kind: ConnectorToolKind;
  action: string;
  demoted: { searchTerms: string[] };
};

export const API_REQUEST_ACTION = "$request";
export const MCP_AUTHORIZE_ACTION = "$authorize";

const NO_INPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

export const API_REQUEST_INPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["path"],
  properties: {
    path: { type: "string", description: "API path beginning with /." },
    method: { type: "string", description: "HTTP method. Defaults to GET." },
    query: {
      type: "object",
      description: "Query parameters.",
      additionalProperties: {
        anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }],
      },
    },
    body: { type: "object", description: "JSON body.", additionalProperties: true },
    headers: {
      type: "object",
      description: "Extra headers. Stella adds the connector's credential itself.",
      additionalProperties: { type: "string" },
    },
  },
};

const OPEN_INPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: true,
};

const slug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "");

const identifier = (name: string): string =>
  /^[0-9]/u.test(name) ? `_${name}` : name;

export const connectorToolName = (
  connectorId: string,
  action: string,
  stripPrefixes: readonly string[] = [],
): string => {
  const namespace = slug(connectorId) || "connector";
  let actionSlug = slug(action);
  for (const prefix of stripPrefixes) {
    const prefixSlug = slug(prefix);
    if (prefixSlug && actionSlug.startsWith(`${prefixSlug}_`)) {
      actionSlug = actionSlug.slice(prefixSlug.length + 1);
      break;
    }
  }
  if (!actionSlug) return namespace;
  if (actionSlug === namespace || actionSlug.startsWith(`${namespace}_`)) {
    return actionSlug;
  }
  return `${namespace}_${actionSlug}`;
};

const collapse = (value: string | undefined): string =>
  (value ?? "").replace(/\s+/gu, " ").trim();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export const buildConnectorToolEntries = (
  sources: readonly ConnectorToolSource[],
  reserved: ReadonlySet<string> = new Set(),
): ConnectorToolEntry[] => {
  const taken = new Set(reserved);
  const entries: ConnectorToolEntry[] = [];
  const ordered = [...sources].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  for (const source of ordered) {
    const actions = [...source.actions].sort((left, right) =>
      left.name.localeCompare(right.name),
    );
    for (const action of actions) {
      const base = identifier(
        action.name.startsWith("$")
          ? `${slug(source.id) || "connector"}_${slug(action.name)}`
          : connectorToolName(source.id, action.name, source.stripPrefixes),
      );
      let name = base;
      for (let index = 2; taken.has(name); index += 1) {
        name = `${base}_${index}`;
      }
      taken.add(name);
      const summary =
        collapse(action.description) ||
        collapse(action.title) ||
        `Run ${action.name}.`;
      entries.push({
        name,
        description: `${source.name}: ${summary}`,
        parameters: isRecord(action.inputSchema)
          ? action.inputSchema
          : action.name === API_REQUEST_ACTION
            ? API_REQUEST_INPUT_SCHEMA
            : action.name === MCP_AUTHORIZE_ACTION
              ? NO_INPUT_SCHEMA
              : OPEN_INPUT_SCHEMA,
        ...(action.annotations ? { annotations: action.annotations } : {}),
        label: `${source.name}: ${collapse(action.title) || action.name}`,
        connector: source.id,
        connectorName: source.name,
        kind: source.kind,
        action: action.name,
        demoted: {
          searchTerms: [source.id, source.name, action.name, action.title ?? ""]
            .map(collapse)
            .filter(Boolean),
        },
      });
    }
  }
  return entries;
};

const MAX_VALIDATION_ERRORS = 5;
const MAX_VALIDATION_DEPTH = 24;

const typeOfValue = (value: unknown): string => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") {
    return Number.isInteger(value) ? "integer" : "number";
  }
  return typeof value;
};

const matchesType = (value: unknown, type: string): boolean => {
  const actual = typeOfValue(value);
  if (type === "number") return actual === "number" || actual === "integer";
  return actual === type;
};

const sameJson = (left: unknown, right: unknown): boolean => {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
};

const childPath = (path: string, key: string): string =>
  /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`;

const collectErrors = (
  schema: unknown,
  value: unknown,
  path: string,
  depth: number,
  errors: string[],
): void => {
  if (errors.length >= MAX_VALIDATION_ERRORS || depth > MAX_VALIDATION_DEPTH) {
    return;
  }
  if (schema === false) {
    errors.push(`${path} is not allowed`);
    return;
  }
  if (!isRecord(schema)) return;

  for (const key of ["anyOf", "oneOf"] as const) {
    const variants = schema[key];
    if (Array.isArray(variants) && variants.length > 0) {
      const matched = variants.some((variant) => {
        const sink: string[] = [];
        collectErrors(variant, value, path, depth + 1, sink);
        return sink.length === 0;
      });
      if (!matched) {
        errors.push(`${path} does not match any allowed shape`);
        return;
      }
    }
  }
  if (Array.isArray(schema.allOf)) {
    for (const part of schema.allOf) {
      collectErrors(part, value, path, depth + 1, errors);
    }
  }
  if ("const" in schema && !sameJson(schema.const, value)) {
    errors.push(`${path} must be ${JSON.stringify(schema.const)}`);
    return;
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => sameJson(item, value))) {
    const options = schema.enum
      .slice(0, 8)
      .map((item) => JSON.stringify(item))
      .join(", ");
    errors.push(`${path} must be one of ${options}${schema.enum.length > 8 ? ", …" : ""}`);
    return;
  }
  const declared = Array.isArray(schema.type)
    ? schema.type.filter((entry): entry is string => typeof entry === "string")
    : typeof schema.type === "string"
      ? [schema.type]
      : [];
  if (declared.length > 0 && !declared.some((type) => matchesType(value, type))) {
    errors.push(`${path} must be ${declared.join(" or ")}, got ${typeOfValue(value)}`);
    return;
  }

  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      errors.push(`${path} must have at least ${schema.minLength} characters`);
    }
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
      errors.push(`${path} must have at most ${schema.maxLength} characters`);
    }
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      errors.push(`${path} must be >= ${schema.minimum}`);
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      errors.push(`${path} must be <= ${schema.maximum}`);
    }
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      errors.push(`${path} must have at least ${schema.minItems} items`);
    }
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
      errors.push(`${path} must have at most ${schema.maxItems} items`);
    }
    if (isRecord(schema.items)) {
      value.forEach((item, index) =>
        collectErrors(schema.items, item, `${path}[${index}]`, depth + 1, errors),
      );
    }
  }
  if (isRecord(value)) {
    const properties = isRecord(schema.properties) ? schema.properties : {};
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (typeof key === "string" && value[key] === undefined) {
          errors.push(`${childPath(path, key)} is required`);
        }
      }
    }
    for (const [key, entry] of Object.entries(value)) {
      if (entry === undefined) continue;
      if (key in properties) {
        collectErrors(properties[key], entry, childPath(path, key), depth + 1, errors);
      } else if (schema.additionalProperties === false) {
        errors.push(`${childPath(path, key)} is not a known argument`);
      } else if (isRecord(schema.additionalProperties)) {
        collectErrors(
          schema.additionalProperties,
          entry,
          childPath(path, key),
          depth + 1,
          errors,
        );
      }
    }
  }
};

export const validateConnectorToolArgs = (
  schema: Record<string, unknown>,
  args: unknown,
): string | null => {
  const errors: string[] = [];
  collectErrors(schema, args, "args", 0, errors);
  return errors.length > 0 ? errors.join("; ") : null;
};

export const invalidConnectorToolArgsMessage = (
  name: string,
  problem: string,
): string =>
  `Invalid arguments for tools.${name}: ${problem}. Run await tools.$describe(${JSON.stringify(name)}) for its input schema.`;

export const requireConnectorTool = (
  entries: readonly ConnectorToolEntry[],
  name: string,
): ConnectorToolEntry => {
  const entry = entries.find((candidate) => candidate.name === name);
  if (!entry) {
    throw new Error(
      `tools.${name} is not an action of a connected service. Find one with await tools.$search({ query }).`,
    );
  }
  return entry;
};
