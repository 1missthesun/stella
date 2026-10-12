import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const walkSourceFiles = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkSourceFiles(entryPath);
    return entry.isFile() && /\.(?:js|ts)$/.test(entry.name) ? [entryPath] : [];
  });
const collectStaticChannelValues = (sourceFile) => {
  const identifiers = new Map();
  const objectProperties = new Map();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
        continue;
      }
      const initializer = ts.isAsExpression(declaration.initializer)
        ? declaration.initializer.expression
        : declaration.initializer;
      if (ts.isStringLiteral(initializer)) {
        identifiers.set(declaration.name.text, initializer.text);
        continue;
      }
      if (!ts.isObjectLiteralExpression(initializer)) continue;
      const properties = new Map();
      for (const property of initializer.properties) {
        if (
          !ts.isPropertyAssignment(property) ||
          !ts.isStringLiteral(property.initializer)
        ) {
          continue;
        }
        const name = ts.isIdentifier(property.name)
          ? property.name.text
          : ts.isStringLiteral(property.name)
            ? property.name.text
            : null;
        if (name) properties.set(name, property.initializer.text);
      }
      objectProperties.set(declaration.name.text, properties);
    }
  }
  return { identifiers, objectProperties };
};
const resolveStaticChannel = (expression, values, sharedIdentifiers) => {
  if (ts.isStringLiteral(expression)) return expression.text;
  if (ts.isIdentifier(expression)) {
    return (
      values.identifiers.get(expression.text) ??
      sharedIdentifiers.get(expression.text) ??
      null
    );
  }
  if (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression)
  ) {
    return (
      values.objectProperties
        .get(expression.expression.text)
        ?.get(expression.name.text) ?? null
    );
  }
  return null;
};
const parseTsFile = (filePath) =>
  ts.createSourceFile(
    filePath,
    readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".js") ? ts.ScriptKind.JS : ts.ScriptKind.TS,
  );
const contractsDir = path.join(repoRoot, "packages/contracts/desktop");
const sharedChannelIdentifiers = () =>
  collectStaticChannelValues(
    parseTsFile(path.join(contractsDir, "ipc-channels.ts")),
  ).identifiers;
const collectContractInvokeChannels = (sharedIdentifiers) => {
  const sourceFile = parseTsFile(path.join(contractsDir, "ipc-contract.ts"));
  const contract = sourceFile.statements.find(
    (statement) =>
      ts.isTypeAliasDeclaration(statement) &&
      statement.name.text === "IpcInvokeContract",
  );
  if (!contract || !ts.isTypeLiteralNode(contract.type)) {
    throw new Error(
      "IpcInvokeContract is not a type literal in ipc-contract.ts",
    );
  }
  const channels = new Set();
  for (const member of contract.type.members) {
    const name = member.name;
    if (!name) continue;
    let channel = null;
    if (ts.isStringLiteral(name)) {
      channel = name.text;
    } else if (ts.isComputedPropertyName(name)) {
      channel = resolveStaticChannel(
        name.expression,
        { identifiers: new Map(), objectProperties: new Map() },
        sharedIdentifiers,
      );
    }
    if (!channel) {
      throw new Error(
        `Cannot resolve IpcInvokeContract key ${name.getText(sourceFile)} to a channel string`,
      );
    }
    channels.add(channel);
  }
  return channels;
};
const collectBridgeInvokeChannels = (sharedIdentifiers) => {
  const sourceFile = parseTsFile(path.join(contractsDir, "electron-api.ts"));
  const values = collectStaticChannelValues(sourceFile);
  const channels = new Set();
  const visit = (node) => {
    if (ts.isCallExpression(node) && node.arguments[0]) {
      const callee = node.expression;
      const isInvoker = ts.isIdentifier(callee) && callee.text === "invoker";
      const isIpcInvoke =
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === "ipc" &&
        callee.name.text === "invoke";
      if (isInvoker || isIpcInvoke) {
        const channel = resolveStaticChannel(
          node.arguments[0],
          values,
          sharedIdentifiers,
        );
        if (channel) channels.add(channel);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return channels;
};
const collectRegisteredInvokeHandlers = (sharedIdentifiers) => {
  const channels = new Set();
  const electronRoot = path.join(repoRoot, "packages/desktop/electron");
  for (const sourcePath of walkSourceFiles(electronRoot)) {
    if (sourcePath.endsWith("preload.ts")) continue;
    const sourceFile = parseTsFile(sourcePath);
    const values = collectStaticChannelValues(sourceFile);
    const visit = (node) => {
      if (!ts.isCallExpression(node)) {
        ts.forEachChild(node, visit);
        return;
      }
      let channelExpression;
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === "ipcMain" &&
        node.expression.name.text === "handle"
      ) {
        channelExpression = node.arguments[0];
      } else if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === "handleIpc"
      ) {
        channelExpression = node.arguments[0];
      } else if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === "registerPrivilegedHandle"
      ) {
        channelExpression = node.arguments[1];
      } else if (
        sourcePath.endsWith("in-app-browser-handlers.ts") &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "register"
      ) {
        channelExpression = node.arguments[0];
      }
      if (channelExpression) {
        const channel = resolveStaticChannel(
          channelExpression,
          values,
          sharedIdentifiers,
        );
        if (channel) channels.add(channel);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return channels;
};
const failures = [];
const sharedIdentifiers = sharedChannelIdentifiers();
const contractInvokes = collectContractInvokeChannels(sharedIdentifiers);
if (sharedIdentifiers.size === 0 || contractInvokes.size === 0) {
  failures.push(
    "Could not read any invoke channels from the typed IPC contract.",
  );
}
const bridgeInvokes = collectBridgeInvokeChannels(sharedIdentifiers);
if (bridgeInvokes.size === 0) {
  failures.push("Could not read any invoke channels from the preload bridge.");
}
const outsideContract = [...bridgeInvokes]
  .filter((channel) => !contractInvokes.has(channel))
  .sort();
if (outsideContract.length > 0) {
  failures.push(
    `Preload bridge invokes channels outside IpcInvokeContract: ${outsideContract.join(", ")}`,
  );
}
const registeredHandlers = collectRegisteredInvokeHandlers(sharedIdentifiers);
const missing = [...contractInvokes]
  .filter((channel) => !registeredHandlers.has(channel))
  .sort();
if (missing.length > 0) {
  failures.push(
    `No main-process handler for contract invoke channels: ${missing.join(", ")}`,
  );
}
if (failures.length > 0) {
  for (const failure of failures)
    console.error(`[verify-ipc-handlers] ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `[verify-ipc-handlers] ${contractInvokes.size} contract invoke channel(s) have main-process handlers.`,
  );
}
