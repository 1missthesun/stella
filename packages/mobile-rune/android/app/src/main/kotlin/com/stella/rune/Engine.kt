package com.stella.rune

import android.view.Surface

/**
 * Stella's Rune engine (`libstella_mobile_engine.so`, packages/mobile-rune/engine): the JNI
 * side of its C API (engine/src/android.rs over engine/src/ffi.rs). `nativePush` is called from
 * the JS thread; everything else on the main thread, where the engine lives. Sizes are dp, the
 * Android counterpart of iOS points.
 */
object Engine {
  init {
    System.loadLibrary("stella_mobile_engine")
  }

  /** What the engine calls back, on the main thread (`wake` from any thread). */
  interface Callbacks {
    /** Engine → TS: one JSON line (UTF-8), for the JS thread's `__runeEvent`. */
    fun event(line: ByteArray)
    /** Engine → app: a JSON message (text fields, haptics, commands). */
    fun nativeMessage(json: ByteArray)
    /** The engine wants a frame. */
    fun wake()
  }

  /** `context`: the application's, for native code that reaches Android's Java APIs (the device link's DNS). */
  @JvmStatic external fun nativeInit(callbacks: Callbacks, context: android.content.Context)
  @JvmStatic external fun nativePush(frame: ByteArray, len: Int)
  /** Frames straight from V8's memory: `len` bytes at `offset` of a direct buffer (no copy on the way). */
  @JvmStatic external fun nativePushDirect(buffer: java.nio.ByteBuffer, offset: Int, len: Int)
  @JvmStatic external fun nativeCreate(surface: Surface, w: Float, h: Float, scale: Float, dark: Boolean): Long
  @JvmStatic external fun nativeSurfaceCreated(host: Long, surface: Surface, w: Float, h: Float, scale: Float): Boolean
  @JvmStatic external fun nativeSurfaceDestroyed(host: Long)
  @JvmStatic external fun nativeDestroy(host: Long)
  /** `out`: drew, animating, wake_after (s; negative: none), cpu_us. */
  @JvmStatic external fun nativeFrame(host: Long, out: DoubleArray)
  @JvmStatic external fun nativeResize(host: Long, w: Float, h: Float, scale: Float)
  @JvmStatic external fun nativeSafeArea(host: Long, top: Float, right: Float, bottom: Float, left: Float)
  @JvmStatic external fun nativeSetDark(host: Long, dark: Boolean)
  @JvmStatic external fun nativeKeyboard(host: Long, height: Float)
  @JvmStatic external fun nativeAccessibility(host: Long, reduceTransparency: Boolean, increaseContrast: Boolean, reduceMotion: Boolean)
  /** phase 0 began, 1 moved, 2 ended, 3 cancelled; x, y in dp; time in seconds. */
  @JvmStatic external fun nativeTouch(host: Long, id: Long, phase: Int, x: Float, y: Float, time: Double)
  @JvmStatic external fun nativeFieldEvent(node: Int, json: ByteArray)
}
