package com.stella.rune

import android.content.Context
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.Process
import android.os.SystemClock
import android.util.Log
import com.caoccao.javet.annotations.V8Function
import com.caoccao.javet.enums.JavetPromiseRejectEvent
import com.caoccao.javet.enums.V8ValueType
import com.caoccao.javet.interop.V8Host
import com.caoccao.javet.interop.V8Runtime
import com.caoccao.javet.interop.options.V8RuntimeOptions
import com.caoccao.javet.values.V8Value
import com.caoccao.javet.values.primitive.V8ValueString
import com.caoccao.javet.values.reference.V8ValueArrayBuffer
import com.caoccao.javet.values.reference.V8ValueObject
import com.caoccao.javet.values.reference.V8ValueTypedArray
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Headers
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Stella's TS/JSX app runs in V8 (Javet) on its own thread, as React Native runs JS off the main
 * thread: React renders and commits there, and the main thread only draws. `__native` is the
 * whole surface the JS side reaches (js/natives.d.ts): the engine bridge (`push`), timers,
 * fetch, WebSocket, storage, crypto, logging and app commands; the web APIs are JS polyfills
 * (js/polyfills.ts). The counterpart of ios/StellaRune/JSRuntime.swift.
 */
class JSRuntime(private val context: Context) {
  private val thread = HandlerThread("stella-js", Process.THREAD_PRIORITY_DISPLAY)
  private lateinit var handler: Handler
  private lateinit var v8: V8Runtime
  private lateinit var global: V8ValueObject
  private val timers = HashMap<Int, Runnable>()
  private val pendingRejections = HashMap<Int, String>()
  private val storage = context.getSharedPreferences("stella-rune-storage", Context.MODE_PRIVATE)
  private val http = OkHttpClient.Builder()
    .readTimeout(0, TimeUnit.MILLISECONDS)
    .pingInterval(30, TimeUnit.SECONDS)
    .build()
  private val httpManual = http.newBuilder().followRedirects(false).followSslRedirects(false).build()
  private val calls = ConcurrentHashMap<Int, Call>()
  private val sockets = ConcurrentHashMap<Int, WebSocket>()
  private val random = SecureRandom()
  var onAppCommand: ((JSONObject) -> Unit)? = null
  /** How long the bundle took to evaluate, in ms. */
  var evalMs = 0.0
    private set

  fun start(bundle: File, env: Map<String, Any?>) {
    thread.start()
    handler = Handler(thread.looper)
    val ready = CountDownLatch(1)
    handler.post {
      val t0 = SystemClock.elapsedRealtimeNanos()
      // V8's Intl data (ICU), which it reads when its library loads.
      V8RuntimeOptions.V8_FLAGS.setIcuDataFile(File(bundle.parentFile, "icudtl.dat").path)
      v8 = V8Host.getV8I18nInstance().createV8Runtime()
      // V8 reports a rejection before an `await` or `.catch` later in the same turn handles it:
      // only those still unhandled once the turn is over are logged.
      v8.setPromiseRejectCallback { event, promise, value ->
        val id = try { promise?.identityHash ?: 0 } catch (_: Throwable) { 0 }
        when (event) {
          JavetPromiseRejectEvent.PromiseRejectWithNoHandler -> {
            pendingRejections[id] = describe(value)
            handler.post {
              pendingRejections.remove(id)?.let { AppLog.write("error", "unhandled rejection: $it") }
            }
          }
          JavetPromiseRejectEvent.PromiseHandlerAddedAfterReject -> pendingRejections.remove(id)
          else -> {}
        }
      }
      global = v8.globalObject
      install(env)
      val tRuntime = (SystemClock.elapsedRealtimeNanos() - t0) / 1e6
      ready.countDown()
      try {
        val src = bundle.readText()
        val t1 = SystemClock.elapsedRealtimeNanos()
        v8.getExecutor(src).setResourceName(bundle.path).executeVoid()
        evalMs = (SystemClock.elapsedRealtimeNanos() - t1) / 1e6
        AppLog.write("info", String.format("V8 runtime %.1f ms; bundle evaluated in %.1f ms (%d KB)", tRuntime, evalMs, src.length / 1024))
      } catch (e: Throwable) {
        AppLog.write("error", "bundle failed: ${e.message}")
      }
    }
    ready.await()
  }

  /** Dev builds' driver: runs `code` in the runtime; its errors go to the log. */
  fun evalDev(code: String) {
    if (!BuildConfig.STELLA_DEV) return
    perform { v8.getExecutor(code).setResourceName("driver.js").executeVoid() }
  }

  /** Runs `block` on the JS thread. */
  fun perform(block: () -> Unit) {
    handler.post {
      try {
        block()
      } catch (e: Throwable) {
        AppLog.write("error", "uncaught: ${e.message}")
      }
    }
  }

  private fun describe(v: V8Value?): String = try {
    if (v is V8ValueObject) (v.getString("stack") ?: v.toString()) else v?.toString() ?: "?"
  } catch (_: Throwable) {
    v.toString()
  }

  /** Calls the global JS function `name` (JS thread). */
  private fun call(name: String, vararg args: Any?) {
    try {
      global.invokeVoid(name, *args)
    } catch (e: Throwable) {
      AppLog.write("error", "$name failed: ${e.message}")
    } finally {
      for (a in args) if (a is V8Value) try { a.close() } catch (_: Throwable) {}
    }
  }

  /** A Uint8Array copy of `data` in the runtime (JS thread). */
  fun u8(data: ByteArray): V8ValueTypedArray {
    val arr = v8.createV8ValueTypedArray(V8ValueType.Uint8Array, data.size)
    if (data.isNotEmpty()) arr.fromBytes(data)
    return arr
  }

  private fun bytesOf(v: V8Value?): ByteArray? = when (v) {
    is V8ValueString -> v.value.toByteArray(Charsets.UTF_8)
    is V8ValueTypedArray -> withView(v) { bb, off, len -> ByteArray(len).also { bb.get(off, it, 0, len) } }
    is V8ValueArrayBuffer -> {
      val bb = v.byteBuffer
      ByteArray(bb.capacity()).also { bb.get(0, it, 0, it.size) }
    }
    else -> null
  }

  /**
   * A typed array's bytes, honouring its view: Javet's `toBytes()` copies from the start of the
   * backing buffer, which is wrong for a `subarray`. `bb` is a direct buffer over V8's memory,
   * valid only inside `f`.
   */
  private fun <T> withView(v: V8ValueTypedArray, f: (java.nio.ByteBuffer, Int, Int) -> T): T {
    val off = v.byteOffset
    val len = v.byteLength
    return v.buffer.use { buf -> f(buf.byteBuffer, off, len) }
  }

  /** Engine → TS: a JSON line from the engine, delivered on the JS thread. */
  fun deliver(line: ByteArray) {
    val s = String(line, Charsets.UTF_8)
    perform { call("__runeEvent", s) }
  }

  fun deliver(line: String) {
    perform { call("__runeEvent", line) }
  }

  private fun install(env: Map<String, Any?>) {
    val n = v8.createV8ValueObject()
    n.set("env", env)
    n.bind(Natives())
    global.set("__native", n)
  }

  /** `__native`'s functions (JS thread). */
  inner class Natives {
    @V8Function(name = "push")
    fun push(v: V8Value?) {
      if (v is V8ValueTypedArray) {
        withView(v) { bb, off, len ->
          if (bb.isDirect) Engine.nativePushDirect(bb, off, len) else bytesOf(v)?.let { Engine.nativePush(it, it.size) }
        }
        return
      }
      val data = bytesOf(v) ?: return
      Engine.nativePush(data, data.size)
    }

    @V8Function(name = "log")
    fun log(level: String, msg: String) = AppLog.write(level, msg)

    @V8Function(name = "now")
    fun now(): Double = System.nanoTime() / 1e6

    @V8Function(name = "epochNow")
    fun epochNow(): Double = System.currentTimeMillis().toDouble()

    @V8Function(name = "setTimer")
    fun setTimer(id: Int, ms: Double, repeats: Boolean) {
      timers.remove(id)?.let { handler.removeCallbacks(it) }
      val delay = maxOf(0L, ms.toLong())
      val r = object : Runnable {
        override fun run() {
          if (timers[id] !== this) return
          if (repeats) handler.postDelayed(this, maxOf(1L, delay)) else timers.remove(id)
          call("__timerFire", id)
        }
      }
      timers[id] = r
      handler.postDelayed(r, delay)
    }

    @V8Function(name = "clearTimer")
    fun clearTimer(id: Int) {
      timers.remove(id)?.let { handler.removeCallbacks(it) }
    }

    @V8Function(name = "post")
    fun post(json: String) {
      val m = try { JSONObject(json) } catch (_: Throwable) { return }
      Handler(Looper.getMainLooper()).post { onAppCommand?.invoke(m) }
    }

    // Storage (localStorage and the UI state): synchronous, like the web's.
    @V8Function(name = "storageGet")
    fun storageGet(k: String): String? = storage.getString(k, null)

    @V8Function(name = "storageSet")
    fun storageSet(k: String, v: String) = storage.edit().putString(k, v).apply()

    @V8Function(name = "storageRemove")
    fun storageRemove(k: String) = storage.edit().remove(k).apply()

    @V8Function(name = "storageKeys")
    fun storageKeys(): List<String> = storage.all.filterValues { it is String }.keys.toList()

    @V8Function(name = "random")
    fun random(count: Int): V8Value {
      val b = ByteArray(maxOf(0, count))
      random.nextBytes(b)
      return u8(b)
    }

    @V8Function(name = "digest")
    fun digest(alg: String, v: V8Value?): V8Value {
      val d = bytesOf(v) ?: ByteArray(0)
      val name = when (alg.uppercase()) {
        "SHA-1" -> "SHA-1"
        "SHA-384" -> "SHA-384"
        "SHA-512" -> "SHA-512"
        else -> "SHA-256"
      }
      return u8(MessageDigest.getInstance(name).digest(d))
    }

    @V8Function(name = "hmac")
    fun hmac(alg: String, key: V8Value?, v: V8Value?): V8Value {
      val name = if (alg.uppercase() == "SHA-512") "HmacSHA512" else "HmacSHA256"
      val k = bytesOf(key) ?: ByteArray(0)
      val mac = Mac.getInstance(name)
      mac.init(SecretKeySpec(if (k.isEmpty()) ByteArray(1) else k, name))
      return u8(mac.doFinal(bytesOf(v) ?: ByteArray(0)))
    }

    @V8Function(name = "readFile")
    fun readFile(path: String): V8Value? {
      val f = File(path)
      if (!f.isFile) return v8.createV8ValueNull()
      return try { u8(f.readBytes()) } catch (_: IOException) { v8.createV8ValueNull() }
    }

    @V8Function(name = "readText")
    fun readText(path: String): String? = try { File(path).takeIf { it.isFile }?.readText() } catch (_: IOException) { null }

    @V8Function(name = "writeFile")
    fun writeFile(path: String, v: V8Value?): Boolean {
      val d = bytesOf(v) ?: return false
      return try {
        val f = File(path)
        f.parentFile?.mkdirs()
        f.writeBytes(d)
        true
      } catch (_: IOException) {
        false
      }
    }

    @V8Function(name = "fetch")
    fun fetch(id: Int, req: V8ValueObject, body: V8Value?) {
      val url = req.getString("url")
      val method = (req.getString("method") ?: "GET").uppercase()
      val manual = req.getString("redirect") == "manual"
      val headers = Headers.Builder()
      try {
        req.get<V8ValueObject>("headers")?.use { h ->
          h.forEach<V8Value, V8Value, Exception> { k, v -> headers.add(k.toString(), v.toString()) }
        }
      } catch (_: Throwable) {}
      val built = headers.build()
      val data = bytesOf(body)
      val rb = when {
        data != null -> data.toRequestBody(built["content-type"]?.toMediaTypeOrNull())
        method == "POST" || method == "PUT" || method == "PATCH" -> ByteArray(0).toRequestBody(null)
        else -> null
      }
      val request = try {
        Request.Builder().url(url ?: "").headers(built).method(method, rb).build()
      } catch (e: Throwable) {
        call("__fetchEvent", id, "error", "bad request: ${e.message}")
        return
      }
      val c = (if (manual) httpManual else http).newCall(request)
      calls[id] = c
      c.enqueue(object : Callback {
        override fun onFailure(call: Call, e: IOException) {
          calls.remove(id)
          perform { call("__fetchEvent", id, "error", e.message ?: "network error") }
        }

        override fun onResponse(call: Call, response: Response) {
          val hs = HashMap<String, String>()
          for (name in response.headers.names()) hs[name.lowercase()] = response.headers.values(name).joinToString(", ")
          val status = response.code
          val finalUrl = response.request.url.toString()
          perform { call("__fetchEvent", id, "head", status, hs, finalUrl) }
          try {
            response.body.source().use { src ->
              val buf = okio.Buffer()
              while (true) {
                val read = src.read(buf, 64 * 1024)
                if (read < 0) break
                val chunk = buf.readByteArray()
                perform { call("__fetchEvent", id, "data", u8(chunk)) }
              }
            }
            perform { call("__fetchEvent", id, "end") }
          } catch (e: IOException) {
            perform { call("__fetchEvent", id, "error", e.message ?: "network error") }
          } finally {
            calls.remove(id)
            response.close()
          }
        }
      })
    }

    @V8Function(name = "fetchAbort")
    fun fetchAbort(id: Int) {
      calls.remove(id)?.cancel()
    }

    @V8Function(name = "wsOpen")
    fun wsOpen(id: Int, url: String, list: V8Value?) {
      val protocols = ArrayList<String>()
      if (list is com.caoccao.javet.values.reference.V8ValueArray) {
        for (i in 0 until list.length) protocols.add(list.getString(i))
      }
      val b = try { Request.Builder().url(url) } catch (_: Throwable) {
        call("__wsEvent", id, "error", "bad url")
        return
      }
      if (protocols.isNotEmpty()) b.header("Sec-WebSocket-Protocol", protocols.joinToString(", "))
      val ws = http.newWebSocket(b.build(), object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
          val proto = response.header("Sec-WebSocket-Protocol") ?: ""
          perform { call("__wsEvent", id, "open", proto) }
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
          perform { call("__wsEvent", id, "message", text) }
        }

        override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
          val b = bytes.toByteArray()
          perform { call("__wsEvent", id, "message", u8(b)) }
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
          webSocket.close(code, null)
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
          sockets.remove(id)
          perform { call("__wsEvent", id, "close", code, reason) }
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
          sockets.remove(id)
          perform { call("__wsEvent", id, "error", t.message ?: "socket error") }
        }
      })
      sockets[id] = ws
    }

    @V8Function(name = "wsSend")
    fun wsSend(id: Int, v: V8Value?) {
      val ws = sockets[id] ?: return
      if (v is V8ValueString) ws.send(v.value) else ws.send((bytesOf(v) ?: ByteArray(0)).toByteString())
    }

    @V8Function(name = "wsClose")
    fun wsClose(id: Int, code: Int, reason: String) {
      sockets.remove(id)?.close(if (code in 1000..4999) code else 1000, reason)
    }
  }
}

/** The app's log: logcat (`adb logcat -s stella`) plus files/stella-rune.log. */
object AppLog {
  private var file: File? = null
  private val lock = Any()

  fun open(context: Context) {
    file = File(context.filesDir, "stella-rune.log").also { it.writeText("") }
  }

  fun write(level: String, msg: String) {
    val prio = when (level) {
      "error" -> Log.ERROR
      "warn" -> Log.WARN
      "debug" -> Log.DEBUG
      else -> Log.INFO
    }
    Log.println(prio, "stella", msg)
    val t = String.format("%.3f", System.nanoTime() / 1e9)
    synchronized(lock) {
      try { file?.appendText("[$t] $level: $msg\n") } catch (_: IOException) {}
    }
  }
}
