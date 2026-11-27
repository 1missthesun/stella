# The device link (crate stella-p2p) is built (or copied from the per-source cache) by
# scripts/stella-p2p.sh into vendor/ when CocoaPods reads this spec, so a fresh checkout or stage
# needs no extra step.
link_ready = system(File.join(__dir__, '..', 'scripts', 'stella-p2p.sh'), 'ios')
raise 'StellaP2p: scripts/stella-p2p.sh ios failed; see its output above' unless link_ready

Pod::Spec.new do |s|
  s.name           = 'StellaP2p'
  s.version        = '1.0.0'
  s.summary        = "Stella's direct device link: pairs with a computer and talks to it over Iroh, no account."
  s.description    = 'Wraps the stella-p2p C API (stella_p2p_start, stella_p2p_command, stella_p2p_stop) for JS.'
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

  s.source_files = '*.swift'
  s.vendored_frameworks = 'vendor/StellaP2pFFI.xcframework'
  s.preserve_paths = 'vendor/**/*'
  # Iroh's system-config and network-change watching.
  s.frameworks = 'SystemConfiguration', 'Security', 'Network'
  s.libraries = 'resolv'
end
