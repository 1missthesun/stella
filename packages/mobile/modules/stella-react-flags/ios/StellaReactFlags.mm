#import "StellaReactFlags.h"

#import <UIKit/UIKit.h>
#import <objc/runtime.h>

#import <React/RCTConvert.h>
#import <React/RCTUtils.h>

#import <react/featureflags/ReactNativeFeatureFlags.h>
#import <react/featureflags/ReactNativeFeatureFlagsOverridesOSSStable.h>
#import <react/renderer/attributedstring/ParagraphAttributes.h>

#include <memory>

namespace {

class StellaReactNativeFeatureFlags final
    : public facebook::react::ReactNativeFeatureFlagsOverridesOSSStable {
 public:
  bool enableSchedulerDelegateInvalidation() override {
    return true;
  }
};

// React Native 0.86's Yoga can lay a text view out up to a pixel shorter than
// its measured height (facebook/yoga#2037, #2040). RN draws and hit-tests the
// text in a container exactly the view's size with NSLineBreakByClipping, so
// TextKit drops the last line and the end of the paragraph disappears. A point
// of room keeps every measured line and is far less than a line, so it never
// adds one. Measurement passes an unbounded height and is unaffected.
using TextStorageForSize = NSTextStorage *(*)(id, SEL, NSAttributedString *,
    facebook::react::ParagraphAttributes, CGSize);

TextStorageForSize originalTextStorageForSize = nullptr;
constexpr CGFloat kContainerRoom = 1.0;

NSTextStorage *textStorageWithRoom(id self, SEL _cmd, NSAttributedString *attributedString,
    facebook::react::ParagraphAttributes paragraphAttributes, CGSize size)
{
  if (size.height < CGFLOAT_MAX && !paragraphAttributes.adjustsFontSizeToFit) {
    size.height += kContainerRoom;
  }
  return originalTextStorageForSize(self, _cmd, attributedString, paragraphAttributes, size);
}

void giveTextContainersRoom()
{
  Class layoutManager = NSClassFromString(@"RCTTextLayoutManager");
  SEL selector = NSSelectorFromString(@"_textStorageAndLayoutManagerWithAttributesString:paragraphAttributes:size:");
  Method method = layoutManager ? class_getInstanceMethod(layoutManager, selector) : nullptr;
  if (method == nullptr) {
    NSLog(@"[StellaReactFlags] RCTTextLayoutManager text container method not found; last lines may clip");
    return;
  }
  originalTextStorageForSize =
      (TextStorageForSize)method_setImplementation(method, (IMP)textStorageWithRoom);
}

// RCTAppearance.setColorScheme treats every connected scene as a
// UIWindowScene. A connected CarPlay head unit adds a
// CPTemplateApplicationScene, which has no `windows`, so applying a color
// scheme with CarPlay attached crashed the app ("unrecognized selector").
void setColorSchemeOnWindowScenes(id self, SEL _cmd, NSString *style)
{
  UIUserInterfaceStyle userInterfaceStyle = [RCTConvert UIUserInterfaceStyle:style];
  NSMutableArray<UIWindow *> *windows = [NSMutableArray new];
  for (UIScene *scene in RCTSharedApplication().connectedScenes) {
    if ([scene isKindOfClass:[UIWindowScene class]]) {
      [windows addObjectsFromArray:((UIWindowScene *)scene).windows];
    }
  }
  for (UIWindow *window in windows) {
    window.overrideUserInterfaceStyle = userInterfaceStyle;
  }
}

void applyColorSchemeOnlyToWindowScenes()
{
  Class appearance = NSClassFromString(@"RCTAppearance");
  Method method = appearance ? class_getInstanceMethod(appearance, NSSelectorFromString(@"setColorScheme:")) : nullptr;
  if (method == nullptr) {
    NSLog(@"[StellaReactFlags] RCTAppearance setColorScheme: not found; CarPlay may crash on color scheme changes");
    return;
  }
  method_setImplementation(method, (IMP)setColorSchemeOnWindowScenes);
}

}

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
    giveTextContainersRoom();
    applyColorSchemeOnlyToWindowScenes();
  });
}

@end
