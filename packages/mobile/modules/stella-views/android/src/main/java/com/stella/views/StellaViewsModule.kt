package com.stella.views

import com.anomalyco.psychoscript.GpuCanvasState
import com.anomalyco.psychoscript.LiveExit
import com.anomalyco.psychoscript.LiveHandler
import com.anomalyco.psychoscript.LiveOptions
import com.anomalyco.psychoscript.LiveRun
import com.anomalyco.psychoscript.Program
import com.anomalyco.psychoscript.PsychoScriptException
import android.app.Activity
import android.content.Intent
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Stella Views' VM on Android: each view program is a psychoscript-mobile live run on a thread of
 * its own. The JS host (`src/views/native-vm.ts`) starts runs, delivers messages and gets each
 * wake-up's posts as one `onRun` event. Mirrors the iOS module and the Rune engine's `views.rs`.
 */
class StellaViewsModule : Module() {
  private class Run(val live: LiveRun, val generation: Long)

  private val runs = HashMap<String, Run>()
  private var generation = 0L

  override fun definition() = ModuleDefinition {
    Name("StellaViews")

    Events("onRun")

    OnActivityEntersBackground { forEachRun { runCatching { it.pause() } } }
    OnActivityEntersForeground { forEachRun { runCatching { it.resume() } } }

    OnDestroy {
      val all = synchronized(runs) { runs.values.map { it.live }.also { runs.clear() } }
      all.forEach { it.stop() }
    }

    AsyncFunction("start") { id: String, program: String, input: String, sliceMs: Double, heapBytes: Double ->
      val compiled = try {
        Program(program, "__input")
      } catch (error: PsychoScriptException) {
        throw ViewRunException(message(error))
      }
      val gen = synchronized(runs) { ++generation }
      val options = LiveOptions(
        sliceBudgetMs = maxOf(1.0, sliceMs).toULong(),
        httpsHosts = null,
        allowLocalNetwork = false,
        maxHeapBytes = maxOf(1.0, heapBytes).toULong(),
      )
      val live = try {
        compiled.startLive(input, Handler(id, gen), options)
      } catch (error: PsychoScriptException) {
        throw ViewRunException(message(error))
      } finally {
        compiled.close()
      }
      val previous = synchronized(runs) { runs.put(id, Run(live, gen))?.live }
      previous?.stop()
      gen.toDouble()
    }

    Function("deliver") { id: String, messages: List<String> ->
      val live = run(id) ?: return@Function
      try {
        for (message in messages) live.deliver(message)
      } catch (error: PsychoScriptException) {
        throw ViewRunException(message(error))
      }
    }

    Function("stop") { id: String ->
      synchronized(runs) { runs.remove(id)?.live }?.stop()
    }

    Function("pause") { id: String -> run(id)?.let { runCatching { it.pause() }.isSuccess } ?: false }

    Function("resume") { id: String -> run(id)?.let { runCatching { it.resume() }.isSuccess } ?: false }

    // `stella.saveFile`: the system "save as" dialog; the new document's URI, or null when cancelled.
    AsyncFunction("saveFile") { name: String, content: String, promise: Promise ->
      val activity = appContext.currentActivity ?: throw ViewRunException("Nothing on screen can show the save dialog")
      pendingSave?.second?.resolve(null)
      pendingSave = content to promise
      val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        type = mimeFor(name)
        putExtra(Intent.EXTRA_TITLE, name.replace(Regex("[\\u0000/\\\\:]"), "_").trim().ifEmpty { "file.txt" })
      }
      activity.startActivityForResult(intent, SAVE_REQUEST)
    }

    OnActivityResult { activity, payload ->
      if (payload.requestCode != SAVE_REQUEST) return@OnActivityResult
      val (content, promise) = pendingSave ?: return@OnActivityResult
      pendingSave = null
      val uri = payload.data?.data
      if (payload.resultCode != Activity.RESULT_OK || uri == null) {
        promise.resolve(null)
        return@OnActivityResult
      }
      try {
        activity.contentResolver.openOutputStream(uri, "wt")!!.use { it.write(content.toByteArray(Charsets.UTF_8)) }
        promise.resolve(uri.toString())
      } catch (error: Exception) {
        promise.reject(ViewRunException("The file couldn't be written: ${error.message}"))
      }
    }

    View(StellaKeyView::class) {
      Events("onChord")
      Prop("chords") { view: StellaKeyView, chords: List<String> -> view.chords = chords.toSet() }
      Prop("autoFocus") { view: StellaKeyView, autoFocus: Boolean -> view.setAutoFocus(autoFocus) }
    }
  }

  private var pendingSave: Pair<String, Promise>? = null

  private fun run(id: String): LiveRun? = synchronized(runs) { runs[id]?.live }

  private fun forEachRun(body: (LiveRun) -> Unit) {
    synchronized(runs) { runs.values.map { it.live } }.forEach(body)
  }

  private fun emit(id: String, generation: Long, body: Map<String, Any>) {
    sendEvent("onRun", body + mapOf("id" to id, "gen" to generation.toDouble()))
  }

  private inner class Handler(private val id: String, private val gen: Long) : LiveHandler {
    override fun onPosts(messagesJson: List<String>) {
      emit(id, gen, mapOf("kind" to "posts", "posts" to messagesJson.joinToString(",", "[", "]")))
    }

    override fun onPostsBytes(messages: List<ByteArray>) {}

    override fun onWarning(message: String) {
      emit(id, gen, mapOf("kind" to "warning", "message" to message))
    }

    override fun onExit(exit: LiveExit) {
      synchronized(runs) { if (runs[id]?.generation == gen) runs.remove(id) }
      when (exit) {
        is LiveExit.Finished -> emit(id, gen, mapOf("kind" to "exit", "exit" to "finished"))
        is LiveExit.Failed -> emit(id, gen, mapOf("kind" to "exit", "exit" to "failed", "message" to message(exit.error)))
        is LiveExit.Stopped -> emit(id, gen, mapOf("kind" to "exit", "exit" to "stopped"))
      }
    }

    override fun onGpuCanvas(key: String?, state: GpuCanvasState) {}
  }

  companion object {
    private const val SAVE_REQUEST = 0x5745

    private fun mimeFor(name: String): String = when (name.substringAfterLast('.', "").lowercase()) {
      "json" -> "application/json"
      "csv" -> "text/csv"
      "md", "markdown" -> "text/markdown"
      "html", "htm" -> "text/html"
      "xml" -> "text/xml"
      "ics" -> "text/calendar"
      "svg" -> "image/svg+xml"
      else -> "text/plain"
    }

    fun message(error: PsychoScriptException): String = when (error) {
      is PsychoScriptException.Syntax -> located(error.reason, error.line, error.column)
      is PsychoScriptException.Runtime -> located(error.reason, error.line, error.column)
      is PsychoScriptException.Timeout -> "The view computed for more than ${error.timeoutMs} ms without waiting"
      is PsychoScriptException.SliceBudget -> "The view computed for more than ${error.budgetMs} ms without waiting"
      is PsychoScriptException.MemoryLimitExceeded -> "The view used more than ${error.maxHeapBytes / (1024uL * 1024uL)} MB of memory"
      is PsychoScriptException.OutputTooLarge -> error.reason
      is PsychoScriptException.InvalidInput -> error.reason
      is PsychoScriptException.Snapshot -> error.reason
      is PsychoScriptException.InvalidState -> error.reason
    }

    private fun located(reason: String, line: UInt?, column: UInt?): String =
      if (line != null && column != null && !reason.contains("(line ")) "$reason (line $line, col $column)" else reason
  }
}

private class ViewRunException(message: String) : CodedException(message)
