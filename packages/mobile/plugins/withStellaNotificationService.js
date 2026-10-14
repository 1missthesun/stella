const { withDangerousMod, withXcodeProject } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const TARGET = "StellaNotificationService";
const SOURCE = "NotificationService.swift";
const INFO_PLIST = `${TARGET}-Info.plist`;
const ENTITLEMENTS = `${TARGET}.entitlements`;
const DEPLOYMENT_TARGET = "16.4";

const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>$(DEVELOPMENT_LANGUAGE)</string>
  <key>CFBundleDisplayName</key>
  <string>Stella Notifications</string>
  <key>CFBundleExecutable</key>
  <string>$(EXECUTABLE_NAME)</string>
  <key>CFBundleIdentifier</key>
  <string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>$(PRODUCT_NAME)</string>
  <key>CFBundlePackageType</key>
  <string>$(PRODUCT_BUNDLE_PACKAGE_TYPE)</string>
  <key>CFBundleShortVersionString</key>
  <string>$(MARKETING_VERSION)</string>
  <key>CFBundleVersion</key>
  <string>$(CURRENT_PROJECT_VERSION)</string>
  <key>NSExtension</key>
  <dict>
    <key>NSExtensionPointIdentifier</key>
    <string>com.apple.usernotifications.service</string>
    <key>NSExtensionPrincipalClass</key>
    <string>$(PRODUCT_MODULE_NAME).NotificationService</string>
  </dict>
</dict>
</plist>
`;

const entitlements = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict/>
</plist>
`;

const withSources = (config) =>
  withDangerousMod(config, [
    "ios",
    async (cfg) => {
      const directory = path.join(cfg.modRequest.platformProjectRoot, TARGET);
      fs.mkdirSync(directory, { recursive: true });
      fs.copyFileSync(
        path.join(__dirname, "notification-service", SOURCE),
        path.join(directory, SOURCE),
      );
      fs.writeFileSync(path.join(directory, INFO_PLIST), infoPlist);
      fs.writeFileSync(path.join(directory, ENTITLEMENTS), entitlements);
      return cfg;
    },
  ]);

const withTarget = (config) =>
  withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    if (project.pbxTargetByName(TARGET)) return cfg;
    const bundleIdentifier = `${cfg.ios.bundleIdentifier}.${TARGET}`;
    const objects = project.hash.project.objects;
    objects.PBXTargetDependency = objects.PBXTargetDependency || {};
    objects.PBXContainerItemProxy = objects.PBXContainerItemProxy || {};

    const group = project.addPbxGroup([SOURCE, INFO_PLIST, ENTITLEMENTS], TARGET, TARGET);
    const groups = objects.PBXGroup;
    for (const key of Object.keys(groups)) {
      const entry = groups[key];
      if (typeof entry === "object" && entry.name === undefined && entry.path === undefined) {
        project.addToPbxGroup(group.uuid, key);
      }
    }

    const target = project.addTarget(TARGET, "app_extension", TARGET, bundleIdentifier);
    project.addBuildPhase([SOURCE], "PBXSourcesBuildPhase", "Sources", target.uuid);
    project.addBuildPhase([], "PBXResourcesBuildPhase", "Resources", target.uuid);
    project.addBuildPhase([], "PBXFrameworksBuildPhase", "Frameworks", target.uuid);

    const marketingVersion = cfg.ios?.version ?? cfg.version ?? "1.0";
    const buildNumber = cfg.ios?.buildNumber ?? "1";
    const configurations = project.pbxXCBuildConfigurationSection();
    for (const key of Object.keys(configurations)) {
      const settings = configurations[key].buildSettings;
      if (!settings || settings.PRODUCT_NAME !== `"${TARGET}"`) continue;
      Object.assign(settings, {
        CODE_SIGN_ENTITLEMENTS: `${TARGET}/${ENTITLEMENTS}`,
        CODE_SIGN_STYLE: "Automatic",
        CURRENT_PROJECT_VERSION: `"${buildNumber}"`,
        GENERATE_INFOPLIST_FILE: "NO",
        INFOPLIST_FILE: `${TARGET}/${INFO_PLIST}`,
        IPHONEOS_DEPLOYMENT_TARGET: DEPLOYMENT_TARGET,
        MARKETING_VERSION: `"${marketingVersion}"`,
        PRODUCT_BUNDLE_IDENTIFIER: `"${bundleIdentifier}"`,
        SKIP_INSTALL: "YES",
        SWIFT_VERSION: "5.0",
        TARGETED_DEVICE_FAMILY: `"1,2"`,
        APPLICATION_EXTENSION_API_ONLY: "YES",
        ...(cfg.ios?.appleTeamId ? { DEVELOPMENT_TEAM: cfg.ios.appleTeamId } : {}),
      });
    }
    if (cfg.ios?.appleTeamId) {
      project.addTargetAttribute("DevelopmentTeam", cfg.ios.appleTeamId, target);
    }
    return cfg;
  });

const withEasExtension = (config) => {
  const bundleIdentifier = `${config.ios?.bundleIdentifier}.${TARGET}`;
  const eas = config.extra?.eas ?? {};
  const existing = eas.build?.experimental?.ios?.appExtensions ?? [];
  if (existing.some((entry) => entry.targetName === TARGET)) return config;
  config.extra = {
    ...config.extra,
    eas: {
      ...eas,
      build: {
        ...eas.build,
        experimental: {
          ...eas.build?.experimental,
          ios: {
            ...eas.build?.experimental?.ios,
            appExtensions: [...existing, { targetName: TARGET, bundleIdentifier, entitlements: {} }],
          },
        },
      },
    },
  };
  return config;
};

module.exports = function withStellaNotificationService(config) {
  if (!config.ios?.bundleIdentifier) return config;
  return withTarget(withSources(withEasExtension(config)));
};
