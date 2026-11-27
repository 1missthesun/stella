package com.stella.p2p

import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject
import java.io.File

/**
 * The phone's side of Stella's direct device link (crate stella-p2p over its C API, through the JNI
 * shim). JS starts one node, runs `command`s (JSON in, `{ok, value}` / `{ok:false, error}` out) and
 * gets the node's events as `onEvent`. Mirrors the iOS module.
 */
class StellaP2pModule : Module() {
  private val lock = Any()
  private var handle = 0L
  private val replies = HashMap<Long, Promise>()
  private var nextToken = 1L
  @Volatile private var startError: String? = null

  private val listener = object : StellaP2pNative.Listener {
    override fun onEvent(json: ByteArray) {
      val text = String(json, Charsets.UTF_8)
      runCatching { JSONObject(text) }.getOrNull()?.let {
        if (it.optString("kind") == "error") startError = it.optString("error")
      }
      sendEvent("onEvent", mapOf("json" to text))
    }

    override fun onReply(token: Long, json: ByteArray) {
      val promise = synchronized(lock) { replies.remove(token) }
      promise?.resolve(String(json, Charsets.UTF_8))
    }
  }

  override fun definition() = ModuleDefinition {
    Name("StellaP2p")

    Events("onEvent")

    OnDestroy { stopNode() }

    AsyncFunction("start") { configJson: String ->
      if (synchronized(lock) { handle != 0L }) return@AsyncFunction
      val context = appContext.reactContext?.applicationContext
        ?: throw CodedException("ERR_P2P_CONTEXT", "No Android context for the device link.", null)
      StellaP2pNative.ensureInit(context)
      val config = runCatching { JSONObject(configJson) }.getOrElse { JSONObject() }
      if (config.optString("dataDir").isEmpty()) {
        // noBackupFilesDir: private to the app and never restored onto another phone, so a new
        // phone pairs again instead of posing as this one.
        val dir = File(context.noBackupFilesDir, "stella-p2p").apply { mkdirs() }
        config.put("dataDir", dir.absolutePath)
      }
      if (!config.has("platform")) config.put("platform", "android")
      startError = null
      val started = StellaP2pNative.start(config.toString().toByteArray(Charsets.UTF_8), listener)
      if (started == 0L) {
        throw CodedException("ERR_P2P_START", startError ?: "The device link didn't start.", null)
      }
      val raced = synchronized(lock) {
        if (handle != 0L) true else { handle = started; false }
      }
      if (raced) StellaP2pNative.stop(started)
    }

    AsyncFunction("command") { name: String, argsJson: String, promise: Promise ->
      val (node, token) = synchronized(lock) {
        val token = nextToken++
        if (handle != 0L) replies[token] = promise
        handle to token
      }
      if (node == 0L) {
        promise.resolve("{\"ok\":false,\"error\":\"The device link isn't running.\"}")
        return@AsyncFunction
      }
      StellaP2pNative.command(node, name.toByteArray(Charsets.UTF_8), argsJson.toByteArray(Charsets.UTF_8), token)
    }

    AsyncFunction("stop") { stopNode() }
  }

  private fun stopNode() {
    val (node, pending) = synchronized(lock) {
      val node = handle
      handle = 0L
      val pending = replies.values.toList()
      replies.clear()
      node to pending
    }
    if (node != 0L) StellaP2pNative.stop(node)
    pending.forEach { it.resolve("{\"ok\":false,\"error\":\"The device link stopped.\"}") }
  }
}
