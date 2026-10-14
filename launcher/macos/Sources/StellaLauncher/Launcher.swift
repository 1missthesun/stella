import Darwin
import Foundation

struct Options {
    var selfTest = false
    var startNow = false
    var showWindow = false
    var holdWindow: URL?
    var source: String?
    var sourceRef: String?
    var backend: String? = ProcessInfo.processInfo.environment["STELLA_LAUNCHER_BACKEND_URL"]
        .flatMap { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : $0 }
    var hold: TimeInterval = 0
    var recoveryChoice: RecoveryChoice?
    var captureDir: URL?
    var localBun: String?
    var readyTimeout: TimeInterval = Options.seconds("STELLA_LAUNCHER_READY_TIMEOUT_SECONDS", 90)
    var stableSeconds: TimeInterval = Options.seconds("STELLA_LAUNCHER_STABLE_SECONDS", 60)

    static func seconds(_ name: String, _ fallback: TimeInterval) -> TimeInterval {
        guard let raw = ProcessInfo.processInfo.environment[name], let value = TimeInterval(raw), value > 0 else {
            return fallback
        }
        return value
    }
}

enum RecoveryChoice: String {
    case returnToKnownGood = "return"
    case reinstall
    case retry
    case quit
}

final class Launcher {
    static let relaunchExitCode: Int32 = 75
    static let knownGoodRef = "refs/stella/known-good"

    private let options: Options
    private var paths: LauncherPaths
    let ui: LauncherWindow
    private let commands = EventQueue<LauncherCommand>()
    private let hold = HoldWindow()
    private let updater: LauncherUpdater
    private var lastHold: [String: Any]?
    private var state: LauncherState
    private var git: GitTool?
    private var signer: TreeSigner?
    private var runtimes: Runtimes?
    private var recoveryCount = 0
    private var crashTimes: [Date] = []
    private(set) var current: ElectronProcess?

    init(options: Options, paths: LauncherPaths) {
        self.options = options
        var paths = paths
        if options.backend == nil { paths.server = ServerConfig.load(paths.serverFile) }
        self.paths = paths
        ui = LauncherWindow(logs: paths.logs, captureDir: options.captureDir)
        state = LauncherState.load(paths)
        updater = LauncherUpdater(paths: paths, selfTest: options.selfTest)
    }

    func run() -> Int32 {
        log("launcher: start root=\(paths.root.path) server=\(paths.server?.origin ?? "default") version=\(LauncherUpdater.ownVersion) selfTest=\(options.selfTest) start=\(options.startNow) pid=\(getpid())")
        if let file = options.holdWindow {
            if let data = try? Data(contentsOf: file),
               let message = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
               let held = UpdateHold(message) {
                hold.show(held, giveUpAfter: 30)
            }
            try? FileManager.default.removeItem(at: file)
        }
        ui.onCommand = { [commands] in commands.post($0) }
        ui.onShutdown = { [weak self] in self?.current?.events.post(.timer("shutdown")) }
        updater.start()
        let facts = installFacts()
        ui.update(show: options.startNow && !options.showWindow ? .keep : .front) { [startNow = options.startNow] in
            $0.phase = startNow ? .starting : .idle
            $0.version = facts.version
            $0.hasKnownGood = facts.hasKnownGood
        }
        if options.startNow { commands.post(.start) }
        if options.selfTest {
            ui.capture("home.png", after: 1) { [ui] in ui.perform("start", after: 0) }
        }

        var closeCode: Int32 = 0
        while let command = commands.next(until: nil) {
            switch command {
            case .close:
                return closeCode
            case .start:
                if !options.startNow || recoveryCount > 0 { updateBeforeStart() }
            case .returnToKnownGood:
                do { try returnToKnownGood() } catch { log("recovery: return failed: \(error)") }
            case .reinstall:
                do { try reinstall() } catch { log("recovery: reinstall failed: \(error)") }
            }
            guard let failure = launch() else {
                log("launcher: Stella quit; exiting")
                return 0
            }
            closeCode = 1
            recover(reason: failure.reason, output: failure.output)
        }
        return 1
    }

    private func updateBeforeStart() {
        let progress: (String, Double, Double) -> Void = { [ui] status, from, to in
            ui.update(show: .reveal) {
                $0.phase = .starting
                $0.status = status
                $0.progress = from
                $0.progressTo = to
            }
        }
        var outcome = updater.waitForFirstCheck(timeout: 0.5, progress: progress)
        if case .timedOut = outcome {
            progress("Checking for updates…", 0, 0.05)
            outcome = updater.waitForFirstCheck(timeout: 120, progress: progress)
        }
        switch outcome {
        case .off, .current:
            return
        case let .staged(version):
            progress("Starting the updated Stella…", 0.95, 1)
            if updater.handOver(to: version, hold: nil, showWindow: true) {
                log("launcher: exit 0 (handed over to \(version) at Start)")
                exit(0)
            }
            fallBack("Update failed. Starting the current version…")
        case .failed:
            fallBack("Couldn't update. Starting the current version…")
        case .timedOut:
            fallBack("Update is slow. Starting the current version…")
        }
    }

    private func fallBack(_ message: String) {
        log("launcher: \(message)")
        ui.update(show: .reveal) {
            $0.phase = .starting
            $0.status = message
            $0.progress = 0
            $0.progressTo = 0.05
        }
        Thread.sleep(forTimeInterval: 2.5)
    }

    private func launch() -> (reason: String, output: [String])? {
        while true {
            ui.update {
                $0.phase = .starting
                $0.status = "Starting Stella…"
                $0.progress = 0
                $0.progressTo = 0.05
            }
            do {
                let electronApp = try prepareForLaunch()
                ui.update {
                    $0.status = "Starting Stella…"
                    $0.progress = 0.94
                    $0.progressTo = 1
                }
                switch supervise(electronApp: electronApp) {
                case .quit:
                    return nil
                case .relaunch:
                    log("launcher: relaunch requested")
                    if let version = updater.stagedVersion, updater.handOver(to: version, hold: lastHold) {
                        log("launcher: exit 0 (handed over to \(version))")
                        exit(0)
                    }
                case let .crashed(sinceReady, detail, output):
                    let now = Date()
                    if sinceReady < options.stableSeconds {
                        crashTimes = crashTimes.filter { now.timeIntervalSince($0) < options.stableSeconds * 2 } + [now]
                    }
                    log("launcher: Stella crashed \(Int(sinceReady))s after ready (\(detail)); recent early crashes \(crashTimes.count)")
                    if crashTimes.count >= 2 {
                        crashTimes = []
                        return ("Stella crashed twice shortly after starting (\(detail)).", output)
                    }
                case let .failed(reason, output):
                    return (reason, output)
                }
            } catch {
                let lines = "\(error)".split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
                return (lines.first ?? "\(error)", Array(lines.dropFirst().suffix(40)))
            }
        }
    }

    private func status(_ text: String) {
        let steps: [(prefix: String, status: String, from: Double, to: Double)] = [
            ("Downloading git", "Getting things ready…", 0.02, 0.10),
            ("Downloading Stella", "Downloading Stella…", 0.10, 0.30),
            ("Downloading Bun", "Getting things ready…", 0.30, 0.40),
            ("Installing Stella's dependencies", "Installing Stella…", 0.40, 0.75),
            ("Preparing Stella", "Finishing setup…", 0.75, 0.85),
            ("Setting up Stella.app", "Finishing setup…", 0.85, 0.94),
        ]
        let step = steps.first { text.hasPrefix($0.prefix) }
        log("progress: \(text)")
        ui.update(show: .reveal) {
            $0.phase = .starting
            $0.status = step?.status ?? text
            if let step {
                $0.progress = step.from
                $0.progressTo = step.to
            }
        }
    }

    private var backend: String { options.backend ?? paths.server?.origin ?? Pins.defaultBackendURL }

    private func followServerFile() {
        guard options.backend == nil else { return }
        let next = ServerConfig.load(paths.serverFile)
        guard next != paths.server else { return }
        log("server: \(paths.server?.origin ?? "default") -> \(next?.origin ?? "default")")
        paths.server = next
        state = LauncherState.load(paths)
    }

    private func prepareForLaunch() throws -> URL {
        let fm = FileManager.default
        followServerFile()
        let (git, signer) = try tools()
        let env = baseEnvironment()

        if !fm.fileExists(atPath: paths.app.appendingPathComponent(".git").path) {
            try Install.cloneSource(paths: paths, git: git, source: source, progress: status)
            try signer.signHead(git: git, app: paths.app, expected: nil)
            state = LauncherState()
            state.installedAt = ISO8601DateFormatter().string(from: Date())
            state.save(paths)
        }

        let verdict = try signer.verifyHead(git: git, app: paths.app)
        guard case .signed = verdict else {
            log("verify: refused: \(verdict)")
            throw LauncherError(refusalMessage(verdict))
        }
        log("verify: HEAD signed and clean")

        let (bun, bunVersion) = try Install.ensureBun(
            paths: paths, baseEnv: env, localBun: options.localBun, progress: status)
        let runtimes = Runtimes(bunBin: bun, bunVersion: bunVersion, git: git)
        self.runtimes = runtimes
        return try Prepare.run(paths: paths, runtimes: runtimes, env: baseEnvironment(),
                               state: &state, progress: status)
    }

    private func tools() throws -> (GitTool, TreeSigner) {
        for dir in [paths.root, paths.logs, paths.runtimes, paths.bundles] {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        let git = try self.git ?? Install.ensureGit(paths: paths, baseEnv: baseEnvironment(), progress: status)
        self.git = git
        let signer = try self.signer ?? TreeSigner(paths: paths)
        self.signer = signer
        return (git, signer)
    }

    private func installFacts() -> (version: String, hasKnownGood: Bool) {
        let gitBin = paths.runtimes.appendingPathComponent("git-\(Pins.gitVersion)/bin/git")
        if git == nil, FileManager.default.isExecutableFile(atPath: gitBin.path) {
            git = try? Install.ensureGit(paths: paths, baseEnv: baseEnvironment(), progress: { _ in })
        }
        guard let git, FileManager.default.fileExists(atPath: paths.app.appendingPathComponent(".git").path) else {
            return ("", false)
        }
        let version = (try? git.run(["rev-parse", "--short=7", "HEAD"], cwd: paths.app)) ?? ""
        return (version, hasKnownGood())
    }

    private var source: Install.Source {
        if let source = options.source { return .explicit(source, ref: options.sourceRef) }
        return .upstream(backend: backend)
    }

    private func refusalMessage(_ verdict: TreeSigner.Verdict) -> String {
        switch verdict {
        case let .dirty(files):
            return "Stella's files were changed outside of Stella's updates, so it won't run them (\(files.count) changed: \(files.prefix(3).map { $0.trimmingCharacters(in: .whitespaces) }.joined(separator: ", ")))."
        case .unsigned:
            return "This version of Stella wasn't installed through Stella's updates (it has no signature), so it won't run."
        case .badSignature:
            return "This version of Stella has an invalid signature, so it won't run."
        case .signed:
            return ""
        }
    }

    private func baseEnvironment() -> [String: String] {
        var env = ProcessInfo.processInfo.environment
        let usesTestKey = !(env["STELLA_LAUNCHER_KEY_FILE"] ?? "").isEmpty
        var stripped = ["STELLA_LAUNCHER_KEY_FILE", "STELLA_LAUNCHER_ROOT", "ELECTRON_RUN_AS_NODE",
                        "STELLA_V2_DEV_DATA_DIR", "STELLA_APP_DIR", "STELLA_RUNTIME_STATE_DIR",
                        "STELLA_DEV_RESTART_REQUEST_FILE", "STELLA_DEV_USER_QUIT_REQUEST_FILE",
                        "STELLA_ELECTRON_DEV_RUNNER_PID", "STELLA_ELECTRON_READY_FILE", "NODE_OPTIONS"]
        let harness = ["STELLA_DEV_HARNESS", "STELLA_DEV_HARNESS_STORAGE_KEY", "STELLA_V2_DEV_USER_DATA_DIR",
                       "STELLA_REMOTE_DEBUG_PORT", "STELLA_DEV_HARNESS_SESSION_TOKEN"]
        if !(paths.isolated && usesTestKey) { stripped += harness }
        for key in stripped {
            env.removeValue(forKey: key)
        }
        if paths.isolated {
            env.removeValue(forKey: "STELLA_DATA_DIR")
        }
        if (env["STELLA_RELEASES_URL"] ?? "").isEmpty {
            env["STELLA_RELEASES_URL"] = Deployment.releasesURL
        }
        var front: [String] = []
        if let runtimes { front.append(runtimes.bunBin.deletingLastPathComponent().path) }
        if let root = git?.root { front.append(root.appendingPathComponent("bin").path) }
        let existing = env["PATH"].flatMap { $0.isEmpty ? nil : $0 } ?? "/usr/bin:/bin:/usr/sbin:/sbin"
        env["PATH"] = (front + [existing]).joined(separator: ":")
        return env
    }

    private func electronEnvironment() -> [String: String] {
        var env = baseEnvironment()
        env["STELLA_LAUNCHER"] = "1"
        env["VITE_STELLA_BACKEND_URL"] = backend
        env["STELLA_LAUNCHER_DATA_DIR"] = paths.root.path
        env.removeValue(forKey: "STELLA_LAUNCHER_SERVER_ID")
        env.removeValue(forKey: "STELLA_LAUNCHER_SERVER_NAME")
        if options.backend == nil, let server = paths.server {
            env["STELLA_LAUNCHER_SERVER_ID"] = server.serverId
            env["STELLA_LAUNCHER_SERVER_NAME"] = server.name
        }
        if let runtimes {
            env["STELLA_BUN_PATH"] = runtimes.bunBin.path
            for (key, value) in runtimes.git.runtimeEnv { env[key] = value }
        }
        if let signer { env["STELLA_LAUNCHER_PUBKEY"] = signer.publicKeySPKIBase64 }
        if paths.isolated {
            env["STELLA_LAUNCHER_USER_DATA_DIR"] = paths.isolatedUserData.path
            env["STELLA_DATA_DIR"] = paths.isolatedHome.path
            env["STELLA_V2_DEV_DATA_DIR"] = paths.isolatedHome.path
        }
        return env
    }

    enum Outcome {
        case quit
        case relaunch
        case crashed(sinceReady: TimeInterval, detail: String, output: [String])
        case failed(String, [String])
    }

    private func supervise(electronApp: URL) -> Outcome {
        guard let git, let signer else { return .failed("The launcher is not set up.", []) }
        let spawnedHead = (try? git.run(["rev-parse", "HEAD"], cwd: paths.app)) ?? ""
        let process: ElectronProcess
        do {
            process = try ElectronProcess(
                executable: electronApp.appendingPathComponent("Contents/MacOS/Electron"),
                // Stella doesn't use AppKit window restoration. Skipping it
                // keeps launch independent of the persistent-UI service, whose
                // XPC call at launch can block Electron's main thread forever.
                args: [paths.app.path, "-ApplePersistenceIgnoreState", "YES"],
                cwd: paths.app,
                env: electronEnvironment(),
                logFile: paths.electronLog)
        } catch {
            return .failed("Stella could not be started: \(error)", [])
        }
        current = process
        defer {
            current = nil
            process.closeChannel()
        }
        process.after(options.readyTimeout, "ready-timeout")

        var readyAt: Date?
        var pending: (String, [String])?
        lastHold = nil
        var quitRequested = false
        var announcedExit: Int32?
        var teardownForced = false
        while let event = process.events.next(until: nil) {
            switch event {
            case let .message(message):
                switch message["op"] as? String {
                case "ready":
                    guard readyAt == nil else { break }
                    readyAt = Date()
                    log("supervisor: ready")
                    // The new window opened over the held frame; let go a beat later.
                    hold.hide(after: 0.25)
                    ui.update(show: .hide) {
                        $0.phase = .running
                        $0.version = String(spawnedHead.prefix(7))
                    }
                    process.after(options.stableSeconds, "stable")
                    updater.startedSuccessfully()
                    if options.selfTest {
                        if options.captureDir != nil { ui.captureRunning() }
                        process.after(options.captureDir != nil ? max(options.hold, 4) : options.hold, "self-test-quit")
                    }
                case "sign":
                    handleSign(message, process: process, git: git, signer: signer)
                case "prepared":
                    adoptPrepared(message, git: git)
                case "hold":
                    if let update = UpdateHold(message) {
                        log("supervisor: holding the window for a restart")
                        lastHold = message
                        hold.show(update, giveUpAfter: 30)
                    }
                case "exiting":
                    let code = (message["code"] as? NSNumber)?.int32Value ?? 0
                    announcedExit = code
                    log("supervisor: Electron is exiting with \(code)")
                    process.after(10, "exit-grace")
                case "failed":
                    let reason = (message["reason"] as? String) ?? "unknown"
                    log("supervisor: Electron reported failure: \(reason)")
                    if pending == nil {
                        pending = ("Stella reported a problem: \(reason)", process.output.lastLines)
                        process.terminate()
                    }
                default:
                    log("supervisor: ignored message \(message)")
                }
            case let .timer(name):
                switch name {
                case "ready-timeout" where readyAt == nil && pending == nil:
                    log("supervisor: no ready within \(Int(options.readyTimeout))s")
                    pending = ("Stella didn't finish starting within \(Int(options.readyTimeout)) seconds.", process.output.lastLines)
                    process.terminate()
                case "stable" where pending == nil:
                    do {
                        try git.run(["update-ref", Launcher.knownGoodRef, spawnedHead], cwd: paths.app)
                        log("supervisor: \(Int(options.stableSeconds))s stable; \(Launcher.knownGoodRef) = \(spawnedHead.prefix(12))")
                    } catch {
                        log("supervisor: could not mark known-good: \(error)")
                    }
                case "self-test-quit", "shutdown":
                    log("supervisor: \(name == "shutdown" ? "Shut down" : "self-test") asks Electron to quit")
                    quitRequested = true
                    process.send(["op": "quit"])
                    process.after(30, "quit-timeout")
                case "quit-timeout" where announcedExit == nil:
                    log("supervisor: Electron did not quit in time; terminating")
                    process.terminate()
                case "exit-grace":
                    log("supervisor: Electron's teardown is still running 10s after it announced its exit; terminating")
                    teardownForced = true
                    process.terminate()
                default:
                    break
                }
            case let .exited(code, signal):
                if !process.drainOutputAfterExit() {
                    log("supervisor: Electron's output pipe is still held open by processes it started")
                }
                let output = process.output.lastLines
                let detail = signal != 0 ? "signal \(signal)" : "exit \(code)"
                log("supervisor: Electron exited (\(detail))")
                if let pending { return .failed(pending.0, output) }
                if let announcedExit, teardownForced {
                    log("supervisor: Electron's teardown did not finish; its announced exit \(announcedExit) stands but cleanup is incomplete")
                }
                let code = announcedExit ?? (signal == 0 ? code : -1)
                let signal = announcedExit != nil ? 0 : signal
                if signal == 0 && code == Launcher.relaunchExitCode { return .relaunch }
                if quitRequested && !(signal == 0 && code == 0) {
                    return .failed("Stella didn't quit cleanly when asked (\(detail)).", output)
                }
                if signal == 0 && code == 0 {
                    if readyAt == nil && options.selfTest {
                        return .failed("Stella quit before it finished starting.", output)
                    }
                    return .quit
                }
                guard let readyAt else {
                    return .failed("Stella stopped before it finished starting (\(detail)).", output)
                }
                return .crashed(sinceReady: Date().timeIntervalSince(readyAt), detail: detail, output: output)
            }
        }
        return .failed("Lost track of Stella.", [])
    }

    private func adoptPrepared(_ message: [String: Any], git: GitTool) {
        var noted: [String] = []
        if let lockHash = message["lockHash"] as? String,
           let actual = try? sha256File(paths.app.appendingPathComponent("bun.lock")),
           actual == lockHash {
            state.bunLockHash = actual
            noted.append("dependencies for lock \(actual.prefix(12))")
        }
        if let head = message["head"] as? String,
           let actual = try? git.run(["rev-parse", "HEAD"], cwd: paths.app),
           actual == head {
            state.preparedHead = actual
            noted.append("setup for \(actual.prefix(12))")
        }
        guard !noted.isEmpty else { return }
        state.save(paths)
        log("supervisor: Stella prepared \(noted.joined(separator: " and "))")
    }

    private func handleSign(_ message: [String: Any], process: ElectronProcess, git: GitTool, signer: TreeSigner) {
        let id = message["id"] ?? NSNull()
        do {
            let head = try signer.signHead(git: git, app: paths.app, expected: message["commit"] as? String)
            process.send(["op": "sign-result", "id": id, "ok": true, "commit": head])
        } catch {
            log("signing: refused: \(error)")
            process.send(["op": "sign-result", "id": id, "ok": false, "error": "\(error)"])
        }
    }

    private func hasKnownGood() -> Bool {
        guard let git else { return false }
        return (try? git.raw(["rev-parse", "--verify", "--quiet", "\(Launcher.knownGoodRef)^{commit}"], cwd: paths.app).code) == 0
    }

    private func recover(reason: String, output: [String]) {
        recoveryCount += 1
        hold.hide(after: 0)
        log("launcher: failure: \(reason)")
        let facts = installFacts()
        ui.update(show: .front) {
            $0.phase = .failed
            $0.reason = reason
            $0.output = output
            $0.hasKnownGood = facts.hasKnownGood
            $0.version = facts.version
        }
        ui.capture("recovery-\(recoveryCount).png", after: 0.5)
        guard options.selfTest else { return }
        if let choice = options.recoveryChoice, recoveryCount == 1 {
            switch choice {
            case .returnToKnownGood: ui.perform(facts.hasKnownGood ? "return" : "reinstall", after: 2)
            case .reinstall: ui.perform("reinstall", after: 2)
            case .retry: ui.perform("start", after: 2)
            case .quit: ui.perform("close", after: 2)
            }
        } else {
            log("launcher: self-test failed: \(reason)")
            ui.perform("close", after: 1.5)
        }
    }

    private func returnToKnownGood() throws {
        let (git, signer) = try tools()
        guard hasKnownGood() else {
            try reinstall()
            return
        }
        let app = paths.app
        if !(try signer.changedFiles(git: git, app: app)).isEmpty {
            let stamp = ISO8601DateFormatter().string(from: Date())
            try git.run(["stash", "push", "--include-untracked", "-m", "Stella recovery \(stamp)"],
                        cwd: app, extraEnv: GitTool.identityEnv)
            log("recovery: stashed uncommitted changes")
        }
        let head = try git.run(["rev-parse", "HEAD"], cwd: app)
        let knownTree = try git.run(["rev-parse", "\(Launcher.knownGoodRef)^{tree}"], cwd: app)
        let headTree = try git.run(["rev-parse", "HEAD^{tree}"], cwd: app)
        if knownTree != headTree {
            let commit = try git.run(
                ["commit-tree", knownTree, "-p", head, "-m", "Return to the last working version"],
                cwd: app, extraEnv: GitTool.identityEnv)
            try git.run(["merge", "--ff-only", commit], cwd: app)
            log("recovery: returned to known-good tree \(knownTree.prefix(12)) as \(commit.prefix(12))")
        }
        try signer.signHead(git: git, app: app, expected: nil)
    }

    private func reinstall() throws {
        let (git, signer) = try tools()
        let fm = FileManager.default
        if fm.fileExists(atPath: paths.app.path) {
            let stamp = Int(Date().timeIntervalSince1970)
            let aside = paths.root.appendingPathComponent("app.previous-\(stamp)")
            try fm.moveItem(at: paths.app, to: aside)
            log("recovery: moved the old checkout to \(aside.path)")
        }
        try Install.cloneSource(paths: paths, git: git, source: source, progress: status)
        try signer.signHead(git: git, app: paths.app, expected: nil)
        state = LauncherState()
        state.installedAt = ISO8601DateFormatter().string(from: Date())
        state.save(paths)
    }
}
