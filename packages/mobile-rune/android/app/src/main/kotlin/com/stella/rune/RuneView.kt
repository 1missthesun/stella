package com.stella.rune

import android.annotation.SuppressLint
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.Choreographer
import android.view.MotionEvent
import android.view.Surface
import android.view.SurfaceHolder
import android.view.SurfaceView
import kotlin.math.hypot

/**
 * The surface Rune draws the whole app into (Vulkan), one frame per `Choreographer` vsync while
 * the engine animates, at the display's rate. Touches go to Rune's own touch handling (scroll
 * physics, presses, drags); text fields are real `EditText`s placed over Rune's boxes
 * (`NativeFields`). The counterpart of ios/StellaRune/RuneView.swift.
 */
@SuppressLint("ViewConstructor")
class RuneView(context: Context, private val dark: () -> Boolean) : SurfaceView(context), SurfaceHolder.Callback, Choreographer.FrameCallback {
  var host: Long = 0
    private set
  private var hasSurface = false
  private var lastW = 0
  private var lastH = 0
  private var scheduled = false
  private val main = Handler(Looper.getMainLooper())
  private val out = DoubleArray(4)
  private val wakeLater = Runnable { wake() }
  private val density get() = resources.displayMetrics.density
  var onFirstFrame: (() -> Unit)? = null
  private var drewFirst = false

  /** Frames presented and their CPU cost, for measurements (`perf.start` / `perf.stop`). */
  var frames = 0
    private set
  val frameCpuUs = ArrayList<Double>()
  val frameTimes = ArrayList<Double>()
  var recording = false

  init {
    holder.addCallback(this)
    isFocusable = false
  }

  // MARK: surface

  override fun surfaceCreated(holder: SurfaceHolder) {}

  override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
    val d = density
    val w = width / d
    val h = height / d
    if (host == 0L) {
      host = Engine.nativeCreate(holder.surface, w, h, d, dark())
      if (host == 0L) {
        AppLog.write("error", "the engine could not draw into the surface")
        return
      }
      hasSurface = true
      App.onHostReady(this)
    } else if (!hasSurface) {
      hasSurface = Engine.nativeSurfaceCreated(host, holder.surface, w, h, d)
    } else if (width != lastW || height != lastH) {
      Engine.nativeResize(host, w, h, d)
    }
    lastW = width
    lastH = height
    if (Build.VERSION.SDK_INT >= 30) {
      val rate = display?.mode?.refreshRate ?: 60f
      holder.surface.setFrameRate(rate, Surface.FRAME_RATE_COMPATIBILITY_DEFAULT)
    }
    wake()
  }

  override fun surfaceDestroyed(holder: SurfaceHolder) {
    if (host != 0L && hasSurface) Engine.nativeSurfaceDestroyed(host)
    hasSurface = false
    if (scheduled) {
      Choreographer.getInstance().removeFrameCallback(this)
      scheduled = false
    }
  }

  // MARK: frames

  /** The engine wants a frame: on the next vsync. Any thread. */
  fun wake() {
    if (Looper.myLooper() != Looper.getMainLooper()) {
      main.post { wake() }
      return
    }
    main.removeCallbacks(wakeLater)
    if (!scheduled && host != 0L && hasSurface) {
      scheduled = true
      Choreographer.getInstance().postFrameCallback(this)
    }
  }

  override fun doFrame(frameTimeNanos: Long) {
    scheduled = false
    if (host == 0L || !hasSurface) return
    Engine.nativeFrame(host, out)
    val drew = out[0] != 0.0
    val animating = out[1] != 0.0
    val wakeAfter = out[2]
    if (drew) {
      frames++
      if (recording) {
        frameCpuUs.add(out[3])
        frameTimes.add(frameTimeNanos / 1e9)
      }
      if (!drewFirst) {
        drewFirst = true
        onFirstFrame?.invoke()
      }
    }
    if (animating || recording) {
      scheduled = true
      Choreographer.getInstance().postFrameCallback(this)
    } else if (wakeAfter >= 0) {
      main.postDelayed(wakeLater, maxOf(1L, (wakeAfter * 1000).toLong()))
    }
  }

  fun resetRecording() {
    frameCpuUs.clear()
    frameTimes.clear()
  }

  // MARK: touches

  private val downAt = HashMap<Int, Pair<Float, Float>>()

  /** A synthetic finger (the dev debug driver): phase 0 began, 1 moved, 2 ended, 3 cancelled; dp. */
  fun inject(id: Long, phase: Int, x: Float, y: Float) {
    if (host == 0L) return
    if (phase == 2) NativeFields.lastTouchEnd = System.nanoTime() / 1e9
    Engine.nativeTouch(host, id, phase, x, y, System.nanoTime() / 1e9)
    wake()
  }

  @SuppressLint("ClickableViewAccessibility")
  override fun onTouchEvent(e: MotionEvent): Boolean {
    if (host == 0L) return true
    val d = density
    fun send(i: Int, phase: Int, x: Float = e.getX(i), y: Float = e.getY(i), t: Long = e.eventTime) {
      Engine.nativeTouch(host, e.getPointerId(i).toLong(), phase, x / d, y / d, t / 1000.0)
    }
    when (e.actionMasked) {
      MotionEvent.ACTION_DOWN, MotionEvent.ACTION_POINTER_DOWN -> {
        val i = e.actionIndex
        downAt[e.getPointerId(i)] = e.getX(i) to e.getY(i)
        send(i, 0)
      }
      MotionEvent.ACTION_MOVE -> {
        // The samples batched since the last frame too, for the scroll's velocity.
        for (hi in 0 until e.historySize) {
          for (i in 0 until e.pointerCount) {
            send(i, 1, e.getHistoricalX(i, hi), e.getHistoricalY(i, hi), e.getHistoricalEventTime(hi))
          }
        }
        for (i in 0 until e.pointerCount) send(i, 1)
      }
      MotionEvent.ACTION_UP, MotionEvent.ACTION_POINTER_UP -> {
        val i = e.actionIndex
        NativeFields.lastTouchEnd = System.nanoTime() / 1e9
        send(i, 2)
        // A tap (not a scroll) outside the native fields ends editing, as a web page's blur does.
        val start = downAt.remove(e.getPointerId(i))
        if (start != null && hypot(e.getX(i) - start.first, e.getY(i) - start.second) < 10 * d) {
          NativeFields.tapOutside()
        }
      }
      MotionEvent.ACTION_CANCEL -> {
        for (i in 0 until e.pointerCount) send(i, 3)
        downAt.clear()
      }
    }
    wake()
    return true
  }

  fun destroy() {
    if (host != 0L) {
      Engine.nativeDestroy(host)
      host = 0
    }
  }
}
