// The Android shell of Stella on Rune. The engine (`libstella_mobile_engine.so`, Rust) and the
// JS bundle (`app.js`, fonts, assets) come from scripts/build-android.sh, which writes them
// under packages/mobile-rune/build/android/ and then runs this build.
plugins {
  id("com.android.application")
}

val generated = rootProject.file("../build/android")

android {
  namespace = "com.stella.rune"
  compileSdk = 37
  ndkVersion = "29.0.14206865"

  defaultConfig {
    applicationId = "com.stella.rune.dev"
    minSdk = 30
    targetSdk = 36
    versionCode = 1
    versionName = "0.1.0"
    ndk { abiFilters += listOf("arm64-v8a", "x86_64") }
  }

  buildTypes {
    debug {
      isDebuggable = true
      buildConfigField("boolean", "STELLA_DEV", "true")
    }
    release {
      isMinifyEnabled = false
      signingConfig = signingConfigs.getByName("debug")
      buildConfigField("boolean", "STELLA_DEV", "false")
    }
  }

  buildFeatures { buildConfig = true }

  sourceSets {
    getByName("main") {
      jniLibs.srcDir(File(generated, "jniLibs"))
      assets.srcDir(File(generated, "assets"))
    }
  }

  packaging {
    jniLibs {
      useLegacyPackaging = false
      // Javet ships armeabi-v7a and x86 too; the app is 64-bit only.
      excludes += listOf("lib/armeabi-v7a/**", "lib/x86/**")
    }
  }

  androidResources {
    // app.js and fonts are read as files; keep them stored, not compressed, in the APK.
    noCompress += listOf("js", "ttf", "otf", "dat")
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
}

dependencies {
  // V8 (with Intl) for the JS thread: JIT, ES2024+, the engine Chrome runs.
  implementation("com.caoccao.javet:javet-v8-android-i18n:6.0.4")
  implementation("com.squareup.okhttp3:okhttp:5.5.1")
}
