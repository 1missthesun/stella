// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
    rules: {
      "react/no-unescaped-entities": "off",
      // eslint-config-expo 57 turns on the React Compiler rules from
      // eslint-plugin-react-hooks v7. The app is not compiled by the React
      // Compiler, and these flag idioms it relies on (refs mirrored during
      // render, state settled in effects), so they stay off here — the same
      // policy the desktop renderer's config applies.
      "react-hooks/immutability": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/purity": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "react-native",
              importNames: ["Text"],
              message: "Import Text from src/components/Text, which applies the Dynamic Type cap.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/components/Text.tsx"],
    rules: { "no-restricted-imports": "off" },
  },
]);
