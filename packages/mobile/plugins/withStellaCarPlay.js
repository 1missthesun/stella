const { withInfoPlist } = require("@expo/config-plugins");

const PHONE_SCENE_ROLE = "UIWindowSceneSessionRoleApplication";
const CARPLAY_SCENE_ROLE = "CPTemplateApplicationSceneSessionRoleApplication";
const VOICE_ENTITLEMENT = "com.apple.developer.carplay-voice-based-conversation";

module.exports = function withStellaCarPlay(config) {
  const entitlements = config.ios?.entitlements ?? {};
  const category = entitlements[VOICE_ENTITLEMENT] ? "voice" : "audio";

  return withInfoPlist(config, (cfg) => {
    cfg.modResults.StellaCarPlayCategory = category;
    cfg.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        [PHONE_SCENE_ROLE]: [
          {
            UISceneClassName: "UIWindowScene",
            UISceneConfigurationName: "Stella-Phone",
            UISceneDelegateClassName: "StellaPhoneSceneDelegate",
          },
        ],
        [CARPLAY_SCENE_ROLE]: [
          {
            UISceneClassName: "CPTemplateApplicationScene",
            UISceneConfigurationName: "Stella-CarPlay",
            UISceneDelegateClassName: "StellaCarPlaySceneDelegate",
          },
        ],
      },
    };
    return cfg;
  });
};
