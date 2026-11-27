# The PsychoScript VM is built (or copied from the per-rev cache) by scripts/psychoscript.sh into
# vendor/ when CocoaPods reads this spec, so a fresh checkout or stage needs no extra step.
vm_ready = system(File.join(__dir__, '..', 'scripts', 'psychoscript.sh'), 'ios')
raise 'StellaViews: scripts/psychoscript.sh ios failed; see its output above' unless vm_ready

Pod::Spec.new do |s|
  s.name           = 'StellaViews'
  s.version        = '1.0.0'
  s.summary        = 'Runs Stella Views programs in a PsychoScript VM, off the JavaScript thread.'
  s.description    = 'Wraps psychoscript-mobile live runs: one VM and thread per view, JSON posts and messages.'
  s.author         = 'FromYou, LLC'
  s.homepage       = 'https://stella.sh'
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.license        = { :type => 'MIT' }

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = '*.swift', 'vendor/PsychoScript.swift'
  s.vendored_frameworks = 'vendor/PsychoScriptFFI.xcframework'
  s.preserve_paths = 'vendor/**/*'
  s.libraries = 'iconv'
end
