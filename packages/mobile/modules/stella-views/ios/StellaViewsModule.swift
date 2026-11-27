import ExpoModulesCore
import UIKit

/// Stella Views' VM on iOS: each view program is a psychoscript-mobile live run on a thread of its
/// own. The JS host (`src/views/native-vm.ts`) starts runs, delivers messages and gets each
/// wake-up's posts as one `onRun` event. Mirrors the Rune engine's `views.rs`.
public final class StellaViewsModule: Module {
  private let lock = NSLock()
  private var runs: [String: (live: LiveRun, generation: UInt64)] = [:]
  private var generation: UInt64 = 0
  private var observers: [NSObjectProtocol] = []

  public func definition() -> ModuleDefinition {
    Name("StellaViews")

    Events("onRun")

    OnCreate {
      let center = NotificationCenter.default
      self.observers = [
        center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: nil) { [weak self] _ in
          self?.forEachRun { try? $0.pause() }
        },
        center.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: nil) { [weak self] _ in
          self?.forEachRun { try? $0.resume() }
        },
      ]
    }

    OnDestroy {
      for observer in self.observers { NotificationCenter.default.removeObserver(observer) }
      self.observers = []
      let all = self.lock.withLock { () -> [LiveRun] in
        let lives = self.runs.values.map(\.live)
        self.runs = [:]
        return lives
      }
      for live in all { live.stop() }
    }

    /// Compiles `program` and starts it with `input` (JSON). Starting an id that runs replaces it.
    AsyncFunction("start") { (id: String, program: String, input: String, sliceMs: Double, heapBytes: Double) throws -> Double in
      let compiled: Program
      do {
        compiled = try Program(source: program, inputName: "__input")
      } catch let error as PsychoScriptError {
        throw ViewRunError(Self.message(error))
      }
      let gen = self.lock.withLock { () -> UInt64 in
        self.generation += 1
        return self.generation
      }
      let options = LiveOptions(
        sliceBudgetMs: UInt64(max(1, sliceMs)),
        httpsHosts: nil,
        allowLocalNetwork: false,
        maxHeapBytes: UInt64(max(1, heapBytes))
      )
      let handler = RunHandler(module: self, id: id, generation: gen)
      let live: LiveRun
      do {
        live = try compiled.startLive(inputJson: input, handler: handler, options: options)
      } catch let error as PsychoScriptError {
        throw ViewRunError(Self.message(error))
      }
      let previous = self.lock.withLock { () -> LiveRun? in
        let old = self.runs[id]?.live
        self.runs[id] = (live, gen)
        return old
      }
      previous?.stop()
      return Double(gen)
    }

    /// Queues messages (each a JSON text) for the program's `receive`, in order.
    Function("deliver") { (id: String, messages: [String]) throws in
      guard let live = self.run(id) else { return }
      for message in messages {
        do {
          try live.deliver(messageJson: message)
        } catch let error as PsychoScriptError {
          throw ViewRunError(Self.message(error))
        }
      }
    }

    Function("stop") { (id: String) in
      let live = self.lock.withLock { self.runs.removeValue(forKey: id)?.live }
      live?.stop()
    }

    Function("pause") { (id: String) -> Bool in
      guard let live = self.run(id) else { return false }
      return (try? live.pause()) != nil
    }

    Function("resume") { (id: String) -> Bool in
      guard let live = self.run(id) else { return false }
      return (try? live.resume()) != nil
    }
  }

  private func run(_ id: String) -> LiveRun? {
    lock.withLock { runs[id]?.live }
  }

  private func forEachRun(_ body: (LiveRun) -> Void) {
    let lives = lock.withLock { runs.values.map(\.live) }
    for live in lives { body(live) }
  }

  fileprivate func emit(_ id: String, _ generation: UInt64, _ body: [String: Any]) {
    var event = body
    event["id"] = id
    event["gen"] = Double(generation)
    sendEvent("onRun", event)
  }

  fileprivate func ended(_ id: String, _ generation: UInt64) {
    lock.withLock {
      if runs[id]?.generation == generation { runs.removeValue(forKey: id) }
    }
  }

  static func message(_ error: PsychoScriptError) -> String {
    switch error {
    case let .Syntax(_, reason, line, column), let .Runtime(_, reason, line, column):
      if let line, let column, !reason.contains("(line ") { return "\(reason) (line \(line), col \(column))" }
      return reason
    case let .Timeout(_, timeoutMs):
      return "The view computed for more than \(timeoutMs) ms without waiting"
    case let .SliceBudget(_, budgetMs):
      return "The view computed for more than \(budgetMs) ms without waiting"
    case let .MemoryLimitExceeded(_, maxHeapBytes):
      return "The view used more than \(maxHeapBytes / (1024 * 1024)) MB of memory"
    case let .OutputTooLarge(reason, _), let .InvalidInput(reason), let .Snapshot(reason), let .InvalidState(reason):
      return reason
    }
  }
}

private struct ViewRunError: Error, CustomStringConvertible, LocalizedError {
  let description: String
  init(_ message: String) { description = message }
  var errorDescription: String? { description }
}

/// Called on the run's own thread; hands everything to the JS host and returns.
private final class RunHandler: LiveHandler, @unchecked Sendable {
  private weak var module: StellaViewsModule?
  private let id: String
  private let generation: UInt64

  init(module: StellaViewsModule, id: String, generation: UInt64) {
    self.module = module
    self.id = id
    self.generation = generation
  }

  func onPosts(messagesJson: [String]) {
    module?.emit(id, generation, ["kind": "posts", "posts": "[" + messagesJson.joined(separator: ",") + "]"])
  }

  func onPostsBytes(messages: [Data]) {}

  func onWarning(message: String) {
    module?.emit(id, generation, ["kind": "warning", "message": message])
  }

  func onExit(exit: LiveExit) {
    module?.ended(id, generation)
    switch exit {
    case .finished:
      module?.emit(id, generation, ["kind": "exit", "exit": "finished"])
    case let .failed(error):
      module?.emit(id, generation, ["kind": "exit", "exit": "failed", "message": StellaViewsModule.message(error)])
    case .stopped:
      module?.emit(id, generation, ["kind": "exit", "exit": "stopped"])
    }
  }

  func onGpuCanvas(key: String?, state: GpuCanvasState) {}
}
