package com.stella.p2p

import android.content.Context

/** The JNI shim (src/main/cpp/stella_p2p_jni.cpp) over the stella-p2p C API. */
internal object StellaP2pNative {
  interface Listener {
    fun onEvent(json: ByteArray)
    fun onReply(token: Long, json: ByteArray)
  }

  init {
    System.loadLibrary("stella_p2p")
    System.loadLibrary("stella_p2p_jni")
  }

  @Volatile private var initialized = false

  /** Once per process, before the first start: Iroh reads the system DNS through the Context. */
  @Synchronized
  fun ensureInit(context: Context) {
    if (initialized) return
    init(context.applicationContext)
    initialized = true
  }

  private external fun init(context: Context)
  external fun start(config: ByteArray, listener: Listener): Long
  external fun command(handle: Long, cmd: ByteArray, args: ByteArray, token: Long)
  external fun stop(handle: Long)
}
