#import "StellaReactFlags.h"

#import <react/featureflags/ReactNativeFeatureFlags.h>
#import <react/featureflags/ReactNativeFeatureFlagsOverridesOSSStable.h>

#include <memory>

namespace {

class StellaReactNativeFeatureFlags final
    : public facebook::react::ReactNativeFeatureFlagsOverridesOSSStable {
 public:
  bool enableSchedulerDelegateInvalidation() override {
    return true;
  }
};

} // namespace

@implementation StellaReactFlags

+ (void)apply
{
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    auto accessed = facebook::react::ReactNativeFeatureFlags::dangerouslyForceOverride(
        std::make_unique<StellaReactNativeFeatureFlags>());
    if (accessed.has_value()) {
      NSLog(@"[StellaReactFlags] Flags were read before the override: %s", accessed->c_str());
    }
  });
}

@end
