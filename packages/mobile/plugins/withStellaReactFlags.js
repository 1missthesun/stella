const { withAppDelegate } = require("@expo/config-plugins");

const IMPORT_ANCHOR = "import React\n";
const IMPORT_LINE = "import StellaReactFlags\n";
const FACTORY_ANCHOR = /^(\s*)let factory = ExpoReactNativeFactory\(delegate: delegate\)\n/m;
const APPLY_CALL = "StellaReactFlags.apply()";

module.exports = function withStellaReactFlags(config) {
  return withAppDelegate(config, (cfg) => {
    if (cfg.modResults.language !== "swift") {
      throw new Error("withStellaReactFlags expects a Swift AppDelegate");
    }
    let contents = cfg.modResults.contents;
    if (!contents.includes(IMPORT_LINE)) {
      if (!contents.includes(IMPORT_ANCHOR)) {
        throw new Error("withStellaReactFlags could not find `import React` in AppDelegate.swift");
      }
      contents = contents.replace(IMPORT_ANCHOR, `${IMPORT_ANCHOR}${IMPORT_LINE}`);
    }
    if (!contents.includes(APPLY_CALL)) {
      if (!FACTORY_ANCHOR.test(contents)) {
        throw new Error(
          "withStellaReactFlags could not find the ExpoReactNativeFactory line in AppDelegate.swift",
        );
      }
      contents = contents.replace(
        FACTORY_ANCHOR,
        (line, indent) => `${line}${indent}${APPLY_CALL}\n`,
      );
    }
    cfg.modResults.contents = contents;
    return cfg;
  });
};
