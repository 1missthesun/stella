/**
 * Whether loading a module a second time is harmless. A module that only
 * declares (functions, classes, constants built without running anything
 * that could keep or start something) can be loaded again next to its old
 * copy: nothing in the old one keeps running and nothing it knew is lost. A
 * module that holds a variable, fills a container, or runs code when loaded
 * cannot, and a change that needs it loaded again takes a page reload instead.
 *
 * A call counts as harmless when it is one of the known constructors below or
 * is marked with the standard pure annotation (the JSX and enum output of the
 * transform already is).
 *
 * A module whose state is only a cache, a count of what is mounted, or a
 * registration that the newer copy should replace says so with a
 * `@reloadable` comment and is then loaded again like one that only declares.
 * State the user would notice losing does not qualify: it lives in a module
 * of its own, or in the view state.
 */

type Node = { type: string; start: number; end: number; [key: string]: unknown };
type Comment = { type: string; value: string; start: number; end: number };

const PURE_CALLS = new Set([
  "lazy",
  "memo",
  "forwardRef",
  "createContext",
  "cva",
  "cn",
  "clsx",
  "Symbol",
  "String",
  "Number",
  "Boolean",
  "BigInt",
  "createFileRoute",
  "createLazyFileRoute",
  "createRootRoute",
  "createRootRouteWithContext",
  "createRoute",
  "createLazyRoute",
  "viewAtom",
]);
const PURE_NAMESPACES = new Set(["Object", "Array", "Math", "JSON", "Number", "String", "Symbol", "Date", "React", "Intl", "z"]);
const PURE_METHODS = new Set([
  "map",
  "filter",
  "flatMap",
  "flat",
  "reduce",
  "join",
  "split",
  "slice",
  "concat",
  "trim",
  "toLowerCase",
  "toUpperCase",
  "replace",
  "replaceAll",
  "includes",
  "indexOf",
  "find",
  "some",
  "every",
  "keys",
  "values",
  "entries",
  "toString",
  "padStart",
  "padEnd",
  "repeat",
  "at",
  "toSorted",
  "toReversed",
  "with",
]);
const PURE_CONSTRUCTORS = new Set(["RegExp", "URL", "Error", "Date", "TextEncoder", "TextDecoder"]);
const TABLE_CONSTRUCTORS = new Set(["Set", "Map"]);
const MUTATING_METHODS = new Set([
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "sort",
  "reverse",
  "fill",
  "copyWithin",
  "set",
  "add",
  "delete",
  "clear",
]);

const RELOADABLE = /^[\s*]*@reloadable\b/;

const rootName = (node: Node | null | undefined): string | null => {
  let current = node;
  while (
    current &&
    (current.type === "MemberExpression" ||
      current.type === "ParenthesizedExpression" ||
      current.type === "CallExpression")
  ) {
    current = (
      current.type === "MemberExpression"
        ? current.object
        : current.type === "CallExpression"
          ? current.callee
          : current.expression
    ) as Node;
  }
  return current?.type === "Identifier" ? (current.name as string) : null;
};

const isHotGuard = (test: Node) =>
  test.type === "MemberExpression" &&
  (test.object as Node).type === "MetaProperty" &&
  (test.property as Node).type === "Identifier" &&
  (test.property as Node).name === "hot";

/** Why the module holds state, or null when it only declares. */
export const moduleStateReason = (program: Node, comments: Comment[], code: string): string | null => {
  if (comments.some((comment) => RELOADABLE.test(comment.value))) return null;
  const text = (node: Node) => code.slice(node.start, Math.min(node.end, node.start + 48)).split("\n")[0]!;
  const pureAt = new Set<number>();
  for (const comment of comments) {
    if (/[@#]__PURE__/.test(comment.value)) pureAt.add(comment.end);
  }
  const isMarkedPure = (node: Node) => pureAt.has(node.start) || pureAt.has(node.start - 1);

  const inertAll = (nodes: (Node | null)[]) => {
    for (const node of nodes) {
      if (!node) continue;
      const reason = inert(node.type === "SpreadElement" ? (node.argument as Node) : node);
      if (reason) return reason;
    }
    return null;
  };

  const classReason = (node: Node): string | null => {
    const superReason = node.superClass ? inert(node.superClass as Node) : null;
    if (superReason) return superReason;
    for (const member of (node.body as Node).body as Node[]) {
      if (member.type === "StaticBlock") return "a class runs a static block";
      if (member.type === "PropertyDefinition" && member.static && member.value) {
        const reason = inert(member.value as Node);
        if (reason) return reason;
      }
    }
    return null;
  };

  const callReason = (node: Node): string | null => {
    const callee = node.callee as Node;
    const args = node.arguments as Node[];
    const named = callee.type === "Identifier" ? (callee.name as string) : null;
    const pureCallee =
      isMarkedPure(node) ||
      (named !== null && PURE_CALLS.has(named)) ||
      (callee.type === "MemberExpression" &&
        !callee.computed &&
        (PURE_NAMESPACES.has(rootName(callee) ?? "") ||
          PURE_METHODS.has(((callee.property as Node).name as string) ?? ""))) ||
      (callee.type === "CallExpression" && callReason(callee) === null);
    if (!pureCallee) {
      return `it calls ${text(callee)}() when loaded`;
    }
    if (callee.type === "MemberExpression") {
      const reason = inert(callee.object as Node);
      if (reason) return reason;
    }
    if (callee.type === "FunctionExpression" || callee.type === "ArrowFunctionExpression") return inertAll(args);
    return inertAll(args);
  };

  const inert = (node: Node): string | null => {
    switch (node.type) {
      case "Literal":
      case "Identifier":
      case "ArrowFunctionExpression":
      case "FunctionExpression":
      case "MetaProperty":
      case "Super":
        return null;
      case "TemplateLiteral":
        return inertAll(node.expressions as Node[]);
      case "ClassExpression":
        return classReason(node);
      case "ArrayExpression":
        return inertAll(node.elements as (Node | null)[]);
      case "ObjectExpression":
        for (const property of node.properties as Node[]) {
          if (property.type === "SpreadElement") {
            const reason = inert(property.argument as Node);
            if (reason) return reason;
            continue;
          }
          const reason =
            (property.computed ? inert(property.key as Node) : null) ?? inert(property.value as Node);
          if (reason) return reason;
        }
        return null;
      case "UnaryExpression":
        return node.operator === "delete" ? "it deletes a property when loaded" : inert(node.argument as Node);
      case "BinaryExpression":
      case "LogicalExpression":
        return inert(node.left as Node) ?? inert(node.right as Node);
      case "ConditionalExpression":
        return inert(node.test as Node) ?? inert(node.consequent as Node) ?? inert(node.alternate as Node);
      case "SequenceExpression":
        return inertAll(node.expressions as Node[]);
      case "ParenthesizedExpression":
      case "ChainExpression":
        return inert(node.expression as Node);
      case "MemberExpression":
        return inert(node.object as Node) ?? (node.computed ? inert(node.property as Node) : null);
      case "CallExpression":
        return callReason(node);
      case "NewExpression": {
        const name = rootName(node.callee as Node) ?? "";
        const args = node.arguments as Node[];
        if (isMarkedPure(node) || PURE_CONSTRUCTORS.has(name) || name === "Intl") return inertAll(args);
        if (TABLE_CONSTRUCTORS.has(name)) return inertAll(args);
        return `it creates a ${name || "object"} when loaded`;
      }
      default:
        return `it runs \`${text(node)}\` when loaded`;
    }
  };

  const tables = new Set<string>();
  const declared = new Set<string>();

  const isEmptyContainer = (init: Node) =>
    (init.type === "NewExpression" && (init.arguments as Node[]).length === 0) ||
    (init.type === "ObjectExpression" && (init.properties as Node[]).length === 0) ||
    (init.type === "ArrayExpression" && (init.elements as Node[]).length === 0);

  const declarationReason = (node: Node, exported = false): string | null => {
    if (node.type === "FunctionDeclaration") {
      if (node.id) declared.add((node.id as Node).name as string);
      return null;
    }
    if (node.type === "ClassDeclaration") {
      if (node.id) declared.add((node.id as Node).name as string);
      return classReason(node);
    }
    if (node.type !== "VariableDeclaration") return `it runs a ${node.type} when loaded`;
    for (const declarator of node.declarations as Node[]) {
      const id = declarator.id as Node;
      const init = declarator.init as Node | null;
      const name = id.type === "Identifier" ? (id.name as string) : null;
      if (node.kind !== "const" && !(init && init.type === "CallExpression" && isMarkedPure(init))) {
        return `it keeps the variable ${name ?? "(destructured)"}`;
      }
      if (!init) continue;
      const reason = inert(init);
      if (reason) return reason;
      if (exported && isEmptyContainer(init)) return `it exports the empty container ${name ?? ""}`;
      if (name) {
        declared.add(name);
        if (init.type === "ObjectExpression" || init.type === "ArrayExpression" || init.type === "NewExpression") {
          tables.add(name);
        }
      }
    }
    return null;
  };

  for (const statement of program.body as Node[]) {
    let reason: string | null = null;
    switch (statement.type) {
      case "ImportDeclaration":
      case "ExportAllDeclaration":
      case "EmptyStatement":
        break;
      case "ExportNamedDeclaration":
        if (statement.declaration) reason = declarationReason(statement.declaration as Node, true);
        break;
      case "ExportDefaultDeclaration": {
        const declaration = statement.declaration as Node;
        reason =
          declaration.type === "FunctionDeclaration" || declaration.type === "ClassDeclaration"
            ? declarationReason(declaration)
            : inert(declaration);
        break;
      }
      case "IfStatement":
        if (!isHotGuard(statement.test as Node)) reason = "it runs code when loaded";
        break;
      case "ExpressionStatement": {
        const expression = statement.expression as Node;
        if (statement.directive) break;
        if (
          expression.type === "AssignmentExpression" &&
          (expression.left as Node).type === "MemberExpression" &&
          declared.has(rootName(expression.left as Node) ?? "") &&
          !tables.has(rootName(expression.left as Node) ?? "")
        ) {
          reason = inert(expression.right as Node);
        } else {
          reason = inert(expression) ?? null;
        }
        break;
      }
      default:
        reason = declarationReason(statement);
    }
    if (reason) return reason;
  }

  if (tables.size === 0) return null;
  let mutated: string | null = null;
  const visit = (value: unknown) => {
    if (mutated || typeof value !== "object" || value === null) return;
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry);
      return;
    }
    const node = value as Node;
    if (typeof node.type === "string") {
      let target: Node | null = null;
      if (node.type === "AssignmentExpression") target = node.left as Node;
      else if (node.type === "UpdateExpression") target = node.argument as Node;
      else if (node.type === "UnaryExpression" && node.operator === "delete") target = node.argument as Node;
      else if (node.type === "CallExpression") {
        const callee = node.callee as Node;
        if (
          callee.type === "MemberExpression" &&
          !callee.computed &&
          MUTATING_METHODS.has((callee.property as Node).name as string)
        ) {
          target = callee;
        } else if (
          callee.type === "MemberExpression" &&
          rootName(callee) === "Object" &&
          (callee.property as Node).name === "assign"
        ) {
          const first = (node.arguments as Node[])[0];
          if (first && tables.has(rootName(first) ?? "")) mutated = rootName(first);
        }
      }
      if (target?.type === "MemberExpression") {
        const name = rootName(target);
        if (name && tables.has(name)) mutated = name;
      }
    }
    for (const key in node) {
      if (key === "type" || key === "start" || key === "end") continue;
      visit(node[key]);
    }
  };
  visit(program.body);
  return mutated ? `it changes ${mutated} after loading` : null;
};
