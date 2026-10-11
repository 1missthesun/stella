Pod::Spec.new do |s|
  s.name           = 'StellaReactFlags'
  s.version        = '1.0.0'
  s.summary        = 'Stella overrides for React Native native feature flags.'
  s.description    = 'Turns on React Native feature flags that guard against known crashes, ' \
                     'on top of the stable release level the app factory installs.'
  s.author         = 'FromYou, LLC'
  s.homepage       = 'https://stella.sh'
  s.platforms      = { :ios => '16.4' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.license        = { :type => 'MIT' }

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++20'
  }

  install_modules_dependencies(s)

  s.source_files = "**/*.{h,mm}"
  s.public_header_files = "StellaReactFlags.h"
end
