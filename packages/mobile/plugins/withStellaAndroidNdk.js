const { withProjectBuildGradle } = require("@expo/config-plugins");

// Every Android library builds with the app's NDK (React Native's pin, `rootProject.ext.ndkVersion`).
// A library that names none (expo-updates) otherwise takes the Android Gradle plugin's default,
// which fails when that NDK is missing or half-installed instead of using the one that is there.
const MARKER = "// withStellaAndroidNdk";
const BLOCK = `
${MARKER}
subprojects { project ->
  project.plugins.withId("com.android.library") {
    project.android.ndkVersion = rootProject.ext.ndkVersion
  }
}
`;

module.exports = function withStellaAndroidNdk(config) {
  return withProjectBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== "groovy") {
      throw new Error("withStellaAndroidNdk expects a Groovy android/build.gradle");
    }
    if (!cfg.modResults.contents.includes(MARKER)) cfg.modResults.contents += BLOCK;
    return cfg;
  });
};
