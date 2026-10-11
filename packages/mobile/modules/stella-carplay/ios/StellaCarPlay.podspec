Pod::Spec.new do |s|
  s.name           = 'StellaCarPlay'
  s.version        = '1.0.0'
  s.summary        = 'Stella CarPlay voice surface and scene delegates.'
  s.description    = 'Owns the CarPlay template scene, the phone window scene, and the voice home template driven from JS.'
  s.author         = 'FromYou, LLC'
  s.homepage       = 'https://stella.sh'
  s.platforms      = { :ios => '16.4' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.license        = { :type => 'MIT' }

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'CarPlay'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift}"
end
