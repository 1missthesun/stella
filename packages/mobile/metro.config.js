const fs = require("node:fs");
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

const nodeNextSourceRoots = ["contracts", "theme"].map(
  (name) => fs.realpathSync(path.join(__dirname, "..", name)) + path.sep,
);

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    moduleName.startsWith(".") &&
    moduleName.endsWith(".js") &&
    nodeNextSourceRoots.some((root) => context.originModulePath.startsWith(root))
  ) {
    const sourcePath = path.resolve(
      path.dirname(context.originModulePath),
      `${moduleName.slice(0, -3)}.ts`,
    );
    if (fs.existsSync(sourcePath)) {
      return { type: "sourceFile", filePath: sourcePath };
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
