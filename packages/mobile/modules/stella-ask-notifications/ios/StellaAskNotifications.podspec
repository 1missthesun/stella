Pod::Spec.new do |s|
  s.name           = 'StellaAskNotifications'
  s.version        = '1.0.0'
  s.summary        = 'Answers Stella questions straight from notification actions.'
  s.description    = 'Sends a notification action answer to the backend natively, with background time, ' \
                     'so it reaches the waiting agent even when the app was not running.'
  s.author         = 'FromYou, LLC'
  s.homepage       = 'https://stella.sh'
  s.platforms      = { :ios => '16.4' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.license        = { :type => 'MIT' }

  s.dependency 'ExpoModulesCore'
  s.dependency 'ExpoNotifications'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift}"
end
