import AppKit
import Darwin
import Foundation

struct Options {
    var selfTest = false
    var startNow = false
    var showWindow = false
    /// The window with its Start, rollback and reinstall controls instead of starting Stella.
    var recovery = false
    var holdWindow: URL?
    var source: String?
    var sourceRef: String?
    var backend: String? = ProcessInfo.processInfo.environment["STELLA_LAUNCHER_BACKEND_URL"]
        .flatMap { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : $0 }
    var hold: TimeInterval = 0
    var recoveryChoice: RecoveryChoice?
    var captureDir: URL?
    var localBun: String?
    var engine: String? = Options.nonEmpty("STELLA_LAUNCHER_ENGINE")
    var engineBin: String? = Options.nonEmpty("STELLA_LAUNCHER_ENGINE_BIN")
    var readyTimeout: TimeInterval = Options.seconds("STELLA_LAUNCHER_READY_TIMEOUT_SECONDS", 90)
    var stableSeconds: TimeInterval = Options.seconds("STELLA_LAUNCHER_STABLE_SECONDS", 60)

    static func nonEmpty(_ name: String) -> String? {
        guard let value = ProcessInfo.processInfo.environment[name], !value.isEmpty else { return nil }
        return value
    }

    static func seconds(_ name: String, _ fallback: TimeInterval) -> TimeInterval {
        guard let raw = ProcessInfo.processInfo.environment[name], let value = TimeInterval(raw), value > 0 else {
            return fallback
        }
        return value
    }
}

enum RecoveryChoice: String {
    case returnToKnownGood = "return"
    case repair
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
    private let state: StateStore
    /// Hydration's thread sets git and the signer while the launcher's may read them.
    private let toolsLock = NSLock()
    private var _git: GitTool?
    private var git: GitTool? {
        get { toolsLock.lock(); defer { toolsLock.unlock() }; return _git }
        set { toolsLock.lock(); _git = newValue; toolsLock.unlock() }
    }
    private var _signer: TreeSigner?
    private var signer: TreeSigner? {
        get { toolsLock.lock(); defer { toolsLock.unlock() }; return _signer }
        set { toolsLock.lock(); _signer = newValue; toolsLock.unlock() }
    }
    private var _runtimes: Runtimes?
    private var runtimes: Runtimes? {
        get { toolsLock.lock(); defer { toolsLock.unlock() }; return _runtimes }
        set { toolsLock.lock(); _runtimes = newValue; toolsLock.unlock() }
    }
    /// Bun before git is there (a first install's app bundle).
    private var bun: (bin: URL, version: String)?
    /// Stella runs from a first install's app bundle this session: git and the
    /// packages come in behind it (hydrate).
    private var bundleStage = false
    private let hydrationLock = NSLock()
    private var hydrating = false
    private var hydrationFinished = false
    private var hydrationStepName = "pending"
    private var engine: (bin: URL, version: String)?
    private var recoveryCount = 0
    /// Repair runs once per launcher run.
    private var repairUsed = false
    /// Set when a repair saved a fix: a failure after it reads "still".
    private var repaired = false
    private var identityRetry: String?
    private var crashTimes: [Date] = []
    private var outsideChanges: OutsideChanges?
    private(set) var current: ElectronProcess?

    init(options: Options, paths: LauncherPaths) {
        self.options = options
        var paths = paths
        if options.backend == nil { paths.server = ServerConfig.load(paths.serverFile) }
        self.paths = paths
        ui = LauncherWindow(logs: paths.logs, captureDir: options.captureDir)
        state = StateStore(LauncherState.load(paths))
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
        // Opening Stella starts it: the window stays hidden unless there is something to show
        // (a first install, an update or install step, a failure), or --recovery asks for it.
        let autoStart = !options.recovery
        let firstInstall = !FileManager.default.fileExists(atPath: paths.app.path)
        let show: LauncherWindow.Show = !autoStart || (options.startNow && options.showWindow) || firstInstall || options.selfTest ? .front : .keep
        ui.update(show: show) {
            $0.phase = autoStart ? .starting : .idle
            if firstInstall { $0.status = "Downloading Stella…" }
            $0.version = facts.version
            $0.hasKnownGood = facts.hasKnownGood
        }
        if autoStart { commands.post(.start) }
        if options.selfTest { ui.capture("home.png", after: 1) }
        log("launcher: \(autoStart ? "starting Stella" : "recovery window: waiting for a choice")")

        var closeCode: Int32 = 0
        var firstStart = autoStart && !options.startNow
        while let command = commands.next(until: nil) {
            switch command {
            case .close:
                return closeCode
            case .start:
                if firstStart || !options.startNow || recoveryCount > 0 { updateBeforeStart(quiet: firstStart) }
            case .repair:
                ui.capture("repairing.png", after: 1.5)
                if let failure = repair() {
                    closeCode = 1
                    recover(reason: failure.reason, output: failure.output, kind: .start, title: failure.title)
                    firstStart = false
                    continue
                }
            case .returnToKnownGood:
                do { try returnToKnownGood() } catch { log("recovery: return failed: \(error)") }
            case .acceptOutsideChanges:
                do { try acceptOutsideChanges() } catch { log("outside: accepting failed: \(error)") }
            case .reinstall:
                do { try reinstall() } catch { log("recovery: reinstall failed: \(error)") }
            }
            guard let failure = launch() else {
                log("launcher: Stella quit; exiting")
                return 0
            }
            if failure.kind == .outsideChanges, let changes = outsideChanges {
                closeCode = options.selfTest ? 1 : 0
                showOutsideChanges(changes)
                continue
            }
            closeCode = 1
            recover(reason: failure.reason, output: failure.output, kind: failure.kind,
                    title: repaired && failure.kind == .start ? "Stella still couldn’t start" : "")
            firstStart = false
        }
        return 1
    }

    /// Opening Stella while it runs brings Stella forward instead of this window. Activating it
    /// isn't enough when its window was closed (Stella keeps running in the menu bar), so it is
    /// also asked to open its window, as Linux and Windows do; a Stella that doesn't answer
    /// within 1.5s gets this window instead.
    func reopened() {
        let process = current
        ui.reopen {
            // Holding Option opens the launcher's own window (Shut down, recovery) instead.
            guard !NSEvent.modifierFlags.contains(.option),
                  let process, let app = NSRunningApplication(processIdentifier: process.pid) else { return false }
            log("launcher: reopened while Stella runs; bringing Stella forward")
            process.events.post(.timer("focus"))
            return app.activate(options: [.activateAllWindows])
        }
    }

    /// quiet: the start that opening Stella makes by itself. A launcher update already
    /// downloaded takes over; a check still running is left for the next start rather than
    /// shown or waited on.
    private func updateBeforeStart(quiet: Bool = false) {
        if quiet {
            switch updater.waitForFirstCheck(timeout: 1.5, progress: { _, _, _ in }) {
            case let .staged(version):
                ui.update(show: .reveal) {
                    $0.phase = .starting
                    $0.status = "Starting the updated Stella…"
                    $0.progress = 0.95
                    $0.progressTo = 1
                }
                if updater.handOver(to: version, hold: nil, showWindow: true) {
                    log("launcher: exit 0 (handed over to \(version) at start)")
                    exit(0)
                }
                log("launcher: handing over to \(version) failed; starting the current version")
            case .timedOut:
                log("launcher: the update check is still running; starting the current version")
            case .off, .current, .failed:
                break
            }
            return
        }
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

    enum FailureKind {
        case start
        case download
        case outsideChanges
    }

    private struct OutsideChangesFound: Error {
        let changes: OutsideChanges
    }

    private func launch() -> (reason: String, output: [String], kind: FailureKind)? {
        while true {
            ui.update {
                $0.phase = .starting
                $0.status = "Starting Stella…"
                $0.progress = 0
                $0.progressTo = 0.05
            }
            do {
                let electronApp = try prepareForLaunch()
                if let version = electronApp.pendingVersion { retryIdentityInBackground(version) }
                ui.update {
                    $0.status = "Starting Stella…"
                    $0.progress = 0.94
                    $0.progressTo = 1
                }
                switch supervise(electronApp: electronApp.app) {
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
                        return ("Stella crashed twice shortly after starting (\(detail)).", output, .start)
                    }
                case let .failed(reason, output):
                    return (reason, output, .start)
                }
            } catch let found as OutsideChangesFound {
                outsideChanges = found.changes
                return ("", [], .outsideChanges)
            } catch let failure as ElectronIdentity.DownloadFailure {
                return ("Stella needs its signed app to keep your Mac's permissions. Check your connection and try again.",
                        ["\(failure)"], .download)
            } catch {
                let lines = "\(error)".split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
                return (lines.first ?? "\(error)", Array(lines.dropFirst().suffix(40)), .start)
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
        state.replace(LauncherState.load(paths))
    }

    private func retryIdentityInBackground(_ version: String) {
        guard identityRetry != version else { return }
        identityRetry = version
        let paths = self.paths
        let env = baseEnvironment()
        let interval = Options.seconds("STELLA_LAUNCHER_IDENTITY_RETRY_SECONDS", 15 * 60)
        DispatchQueue.global(qos: .utility).async {
            while true {
                Thread.sleep(forTimeInterval: interval)
                if ElectronIdentity.retryDownload(paths: paths, version: version, env: env) {
                    log("identity: signed Stella.app for Electron \(version) downloaded; used from the next launch")
                    return
                }
            }
        }
    }

    private func prepareForLaunch() throws -> ElectronIdentity.Resolved {
        let fm = FileManager.default
        followServerFile()
        let gitDir = paths.app.appendingPathComponent(".git")
        let firstInstall = !fm.fileExists(atPath: gitDir.path)
        if firstInstall {
            try fm.createDirectory(at: paths.runtimes, withIntermediateDirectories: true)
            try fm.createDirectory(at: paths.logs, withIntermediateDirectories: true)
            Install.prefetchBun(paths: paths, baseEnv: baseEnvironment(), localBun: options.localBun)
        }

        if firstInstall && !fm.fileExists(atPath: paths.app.path) && !electronForced {
            // A first install: from the app bundle when there is one.
            var manifest = Options.nonEmpty("STELLA_LAUNCHER_BUNDLE_MANIFEST")
            if manifest == nil && options.source == nil {
                do {
                    manifest = try Install.bootstrapAccess(backend: backend).bundleManifest
                } catch {
                    log("install: bootstrap failed (\(error))")
                }
            }
            if let manifest {
                do {
                    let commit = try Install.installBundle(
                        paths: paths, manifest: manifest, prefetchEngine: options.engineBin == nil, progress: status)
                    var fresh = LauncherState()
                    fresh.installedAt = ISO8601DateFormatter().string(from: Date())
                    fresh.bundleCommit = commit
                    state.replace(fresh)
                    state.update(paths) { _ in }
                } catch {
                    log("install: the app bundle failed (\(error)); cloning instead")
                }
            }
        }

        if !fm.fileExists(atPath: gitDir.path), let commit = state.current.bundleCommit, fm.fileExists(atPath: paths.app.path) {
            for dir in [paths.root, paths.logs, paths.runtimes, paths.bundles] {
                try fm.createDirectory(at: dir, withIntermediateDirectories: true)
            }
            if signer == nil { signer = try TreeSigner(paths: paths) }
            if engineRequested {
                // Rune opens from the bundle; hydration follows once it is up.
                let bun = try Install.ensureBun(paths: paths, baseEnv: baseEnvironment(), localBun: options.localBun, progress: status)
                self.bun = bun
                let engine = try Install.ensureEngine(paths: paths, localBin: options.engineBin, progress: status)
                self.engine = engine
                bundleStage = true
                if !hydrationStarted {
                    hydrationStepName = "pending"
                    writeHydration("pending")
                }
                log("install: starting stella-engine \(engine.version) from the app bundle \(commit.prefix(12)); hydrating once Stella is up")
                return ElectronIdentity.Resolved(app: paths.app, pendingVersion: nil)
            }
            // Electron needs the packages: hydrate before the window.
            log("install: Electron starts here; hydrating the app bundle first")
            status("Installing Stella's dependencies…")
            self.bun = try Install.ensureBun(paths: paths, baseEnv: baseEnvironment(), localBun: options.localBun, progress: status)
            try hydrate(rune: false)
        }
        bundleStage = false
        // A relaunch while hydration still installs the packages waits for it, rather than
        // installing them beside it.
        while hydrationRunning { Thread.sleep(forTimeInterval: 0.25) }

        let (git, signer) = try tools()
        let env = baseEnvironment()

        if !fm.fileExists(atPath: gitDir.path) {
            try Install.cloneSource(paths: paths, git: git, source: source, progress: status)
            try signer.signHead(git: git, app: paths.app, expected: nil)
            var fresh = LauncherState()
            fresh.installedAt = ISO8601DateFormatter().string(from: Date())
            state.replace(fresh)
            state.update(paths) { _ in }
            if !engineRequested { ElectronIdentity.prefetch(paths: paths, env: env) }
        }

        if let changes = try signer.outsideChanges(git: git, app: paths.app) {
            log("verify: \(changes.files.count) file(s) changed outside Stella since the last signed version (HEAD \(changes.head.prefix(12)), tree \(changes.tree.prefix(12)))")
            throw OutsideChangesFound(changes: changes)
        }
        log("verify: HEAD signed and clean")
        let rune = engineRequested
        if rune && options.engineBin == nil { Install.prefetchEngine(paths: paths) }

        let (bun, bunVersion) = try Install.ensureBun(
            paths: paths, baseEnv: env, localBun: options.localBun, progress: status)
        self.bun = (bun, bunVersion)
        let runtimes = Runtimes(bunBin: bun, bunVersion: bunVersion, git: git)
        self.runtimes = runtimes
        let electron = try Prepare.run(paths: paths, runtimes: runtimes, env: baseEnvironment(),
                                       rune: rune, state: state, progress: status)
        engine = nil
        if rune {
            let engine = try Install.ensureEngine(paths: paths, localBin: options.engineBin, progress: status)
            log("launcher: starting stella-engine \(engine.version) (\(engine.bin.path)) instead of Electron")
            self.engine = engine
        }
        return electron
    }

    /// Electron chosen by hand (engineRequested's flag, environment or <root>/electron-engine):
    /// a first install then clones, since the app bundle is for Rune.
    private var electronForced: Bool {
        if let engine = options.engine { return engine != "rune" }
        if options.engineBin != nil { return false }
        return FileManager.default.fileExists(atPath: paths.root.appendingPathComponent("electron-engine").path)
    }

    // MARK: - Hydration (stage 2 of a first install from an app bundle)
    //
    // Stage 1 (prepareForLaunch, before the window): download the app bundle while Bun
    // downloads, unpack it, fetch the engine and start Stella. Stage 2 (hydrate, once Stella is
    // ready): check the same commit out in place, sign it, install the packages and prepare the
    // install, then mark hydration.json done; what in Stella needs git or the packages waits on
    // that file meanwhile (packages/node-shared/integrations/app-hydration.ts). Without a bundle
    // (none offered, Electron forced, any step failing) a first install clones and installs
    // before the window, as before.

    private var hydrationStarted: Bool {
        hydrationLock.lock()
        defer { hydrationLock.unlock() }
        return hydrating
    }

    private var hydrationRunning: Bool {
        hydrationLock.lock()
        defer { hydrationLock.unlock() }
        return hydrating && !hydrationFinished
    }

    private func writeHydration(_ status: String, error: String? = nil) {
        var body: [String: Any] = ["status": status, "pid": Int(getpid()), "step": hydrationStepName]
        if let error { body["error"] = error }
        guard var data = try? JSONSerialization.data(withJSONObject: body, options: [.sortedKeys]) else { return }
        data.append(0x0A)
        try? data.write(to: paths.hydrationFile, options: .atomic)
    }

    private func hydrationStep(_ step: String) {
        hydrationStepName = step
        writeHydration("running")
        log("hydrate: \(step)")
    }

    private func startHydration() {
        hydrationLock.lock()
        guard !hydrating else {
            hydrationLock.unlock()
            return
        }
        hydrating = true
        hydrationFinished = false
        hydrationLock.unlock()
        let thread = Thread { [self] in
            let started = Date()
            do {
                try hydrate(rune: true)
                hydrationStepName = "done"
                writeHydration("done")
                log("hydrate: done in \(String(format: "%.1f", Date().timeIntervalSince(started)))s")
            } catch {
                log("hydrate: failed at \(hydrationStepName): \(error)")
                writeHydration("failed", error: "\(error)")
            }
            hydrationLock.lock()
            hydrationFinished = true
            hydrationLock.unlock()
        }
        // Behind the open window: never ahead of it for the CPU (Shell.run passes it on).
        thread.qualityOfService = .utility
        thread.start()
    }

    /// Stage 2: the git checkout of the bundle's commit, its signature, the packages.
    private func hydrate(rune: Bool) throws {
        let fm = FileManager.default
        guard let commit = state.current.bundleCommit else { throw LauncherError("No app bundle to hydrate.") }
        let app = paths.app
        let hydrateDir = app.appendingPathComponent(".git-hydrate")
        let finalDir = app.appendingPathComponent(".git")
        let branch = options.sourceRef ?? Pins.upstreamBranch
        let main = Pins.upstreamBranch
        let upstream = Pins.upstreamRemoteName
        var placed = false
        var succeeded = false
        defer {
            if !succeeded {
                try? fm.removeItem(at: hydrateDir)
                // An unsigned checkout would read as changed outside Stella.
                if placed { try? fm.removeItem(at: finalDir) }
            }
        }

        hydrationStep("git")
        let (git, signer) = try tools(quiet: bundleStage)
        let remote: String
        var auth: [String: String] = [:]
        if let source = options.source {
            remote = source
        } else {
            let access = try Install.bootstrapAccess(backend: backend)
            remote = access.remote
            auth = [
                "GIT_CONFIG_COUNT": "2",
                "GIT_CONFIG_KEY_0": "http.extraHeader",
                "GIT_CONFIG_VALUE_0": "Authorization: Bearer \(access.token)",
                "GIT_CONFIG_KEY_1": "protocol.version",
                "GIT_CONFIG_VALUE_1": "1",
            ]
        }
        let gd = ["--git-dir", hydrateDir.path]
        let hgit = { (args: [String]) throws -> String in
            try git.run(gd + ["--work-tree", app.path] + args, cwd: app)
        }
        try? fm.removeItem(at: hydrateDir)
        _ = try hgit(["init", "-q"])
        _ = try hgit(["symbolic-ref", "HEAD", "refs/heads/\(main)"])
        _ = try hgit(["remote", "add", upstream, remote])
        let fetchStarted = Date()
        try git.run(gd + ["fetch", "-q", "--no-tags", upstream, "+refs/heads/\(branch):refs/remotes/\(upstream)/\(branch)"],
                    cwd: app, extraEnv: auth)
        log("hydrate: fetched \(branch) in \(String(format: "%.1f", Date().timeIntervalSince(fetchStarted)))s")
        if try git.raw(gd + ["cat-file", "-e", "\(commit)^{commit}"], cwd: app).code != 0 {
            // The branch moved past the bundle's commit without keeping it: ask for it by name.
            try git.run(gd + ["fetch", "-q", "--no-tags", upstream, commit], cwd: app, extraEnv: auth)
        }
        _ = try hgit(["update-ref", "refs/heads/\(main)", commit])
        _ = try hgit(["config", "branch.\(main).remote", upstream])
        _ = try hgit(["config", "branch.\(main).merge", "refs/heads/\(main)"])
        // The index from the commit, against the files already there.
        _ = try hgit(["reset", "-q"])
        let changed = try hgit(["status", "--porcelain=v1", "--untracked-files=no"])
        guard changed.isEmpty else {
            throw LauncherError("The app bundle differs from \(commit.prefix(12)): \(changed.prefix(300))")
        }
        try fm.moveItem(at: hydrateDir, to: finalDir)
        placed = true
        // init with --work-tree records it; a clone does not.
        _ = try? git.raw(["config", "--unset", "core.worktree"], cwd: app)

        hydrationStep("sign")
        try signer.signHead(git: git, app: app, expected: commit)
        // A signed checkout: from here on the launcher treats it as installed,
        // and installs what is missing before the window if this run stops.
        state.update(paths) { $0.bundleCommit = nil }
        placed = false

        hydrationStep("packages")
        guard let bun else { throw LauncherError("Bun is not set up yet.") }
        let runtimes = Runtimes(bunBin: bun.bin, bunVersion: bun.version, git: git)
        self.runtimes = runtimes
        _ = try Prepare.run(paths: paths, runtimes: runtimes, env: baseEnvironment(), rune: rune, state: state,
                            hydration: paths.hydrationFile, progress: { _ in })
        succeeded = true
    }

    /// Rune is the engine wherever the source supports it; --engine, the environment and the files
    /// <root>/electron-engine and <root>/rune-engine choose one by hand.
    private var engineRequested: Bool {
        if let engine = options.engine { return engine == "rune" }
        if options.engineBin != nil { return true }
        let fm = FileManager.default
        if fm.fileExists(atPath: paths.root.appendingPathComponent("electron-engine").path) { return false }
        if fm.fileExists(atPath: paths.root.appendingPathComponent("rune-engine").path) { return true }
        return Install.engineAvailable(paths: paths)
    }

    /// quiet: hydration's (Stella is already open; the launcher window stays hidden).
    private func tools(quiet: Bool = false) throws -> (GitTool, TreeSigner) {
        for dir in [paths.root, paths.logs, paths.runtimes, paths.bundles] {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        let progress: (String) -> Void = quiet ? { log("hydrate: \($0)") } : status
        let git = try self.git ?? Install.ensureGit(paths: paths, baseEnv: baseEnvironment(), progress: progress)
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

    private func baseEnvironment() -> [String: String] {
        var env = ProcessInfo.processInfo.environment
        let usesTestKey = !(env["STELLA_LAUNCHER_KEY_FILE"] ?? "").isEmpty
        var stripped = ["STELLA_LAUNCHER_KEY_FILE", "STELLA_LAUNCHER_ROOT", "ELECTRON_RUN_AS_NODE",
                        "STELLA_V2_DEV_DATA_DIR", "STELLA_APP_DIR", "STELLA_RUNTIME_STATE_DIR",
                        "STELLA_DEV_RESTART_REQUEST_FILE", "STELLA_DEV_USER_QUIT_REQUEST_FILE",
                        "STELLA_ELECTRON_DEV_RUNNER_PID", "STELLA_ELECTRON_READY_FILE", "NODE_OPTIONS",
                        "STELLA_LAUNCHER_ENGINE", "STELLA_LAUNCHER_ENGINE_BIN", "STELLA_RUNE_ROOT", "STELLA_RUNE_BUN",
                        "STELLA_RUNE_SERVICES", "STELLA_APP_HYDRATION"]
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
        if let bin = runtimes?.bunBin ?? bun?.bin { front.append(bin.deletingLastPathComponent().path) }
        if let root = (git ?? (bundleStage ? Install.plannedGit(paths: paths, baseEnv: [:]) : nil))?.root {
            front.append(root.appendingPathComponent("bin").path)
        }
        let existing = env["PATH"].flatMap { $0.isEmpty ? nil : $0 } ?? "/usr/bin:/bin:/usr/sbin:/sbin"
        env["PATH"] = (front + [existing]).joined(separator: ":")
        return env
    }

    private func electronEnvironment() -> [String: String] {
        var env = baseEnvironment()
        env["STELLA_LAUNCHER"] = "1"
        env["VITE_STELLA_BACKEND_URL"] = backend
        env["STELLA_LAUNCHER_DATA_DIR"] = paths.root.path
        env["STELLA_LAUNCHER_VERSION"] = String(LauncherUpdater.ownVersion)
        env.removeValue(forKey: "STELLA_LAUNCHER_SERVER_ID")
        env.removeValue(forKey: "STELLA_LAUNCHER_SERVER_NAME")
        if options.backend == nil, let server = paths.server {
            env["STELLA_LAUNCHER_SERVER_ID"] = server.serverId
            env["STELLA_LAUNCHER_SERVER_NAME"] = server.name
        }
        if let bin = runtimes?.bunBin ?? bun?.bin { env["STELLA_BUN_PATH"] = bin.path }
        if let runtimes {
            for (key, value) in runtimes.git.runtimeEnv { env[key] = value }
        } else if bundleStage {
            // The pinned git hydration puts in place: what runs git waits for hydration, and
            // then finds it there (rather than /usr/bin/git, which may only offer to install
            // the Command Line Tools).
            for (key, value) in Install.plannedGit(paths: paths, baseEnv: [:]).runtimeEnv { env[key] = value }
        }
        if let signer { env["STELLA_LAUNCHER_PUBKEY"] = signer.publicKeySPKIBase64 }
        if bundleStage {
            // What needs git or the packages waits on this file (app-hydration.ts).
            env["STELLA_APP_HYDRATION"] = paths.hydrationFile.path
            env["GIT_CEILING_DIRECTORIES"] = paths.root.path
        }
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
        guard signer != nil else { return .failed("The launcher is not set up.", []) }
        // A first install's app bundle has no checkout yet (bundleStage).
        let spawnedHead = (try? git?.run(["rev-parse", "HEAD"], cwd: paths.app)) ?? ""
        let child = engine == nil ? "Electron" : "stella-engine"
        let process: ElectronProcess
        do {
            if let engine {
                var env = electronEnvironment()
                env["STELLA_LAUNCHER_ENGINE"] = "rune"
                env["STELLA_RUNE_SERVICES"] = "1"
                env.removeValue(forKey: "BUN_RUNTIME_TRANSPILER_CACHE_PATH")
                env["MIMALLOC_PURGE_DELAY"] = "0"
                env["STELLA_RUNE_ROOT"] = paths.app.appendingPathComponent("packages/desktop-rune").path
                if let bin = runtimes?.bunBin ?? bun?.bin { env["STELLA_RUNE_BUN"] = bin.path }
                process = try ElectronProcess(
                    executable: engine.bin, args: [], cwd: paths.app, env: env, logFile: paths.electronLog, isEngine: true)
            } else {
                process = try ElectronProcess(
                    executable: electronApp.appendingPathComponent("Contents/MacOS/Electron"),
                    // Stella doesn't use AppKit window restoration. Skipping it
                    // keeps launch independent of the persistent-UI service, whose
                    // XPC call at launch can block Electron's main thread forever.
                    args: [paths.app.path, "-ApplePersistenceIgnoreState", "YES"],
                    cwd: paths.app,
                    env: electronEnvironment(),
                    logFile: paths.electronLog)
            }
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
        var focusAsked = 0
        var focusPending = false
        while let event = process.events.next(until: nil) {
            switch event {
            case let .message(message):
                switch message["op"] as? String {
                case "ready":
                    guard readyAt == nil else { break }
                    readyAt = Date()
                    log("supervisor: ready")
                    if bundleStage { startHydration() }
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
                case "focused":
                    focusPending = false
                case "sign":
                    handleSign(message, process: process)
                case "prepared":
                    adoptPrepared(message)
                case "hold":
                    if let update = UpdateHold(message) {
                        log("supervisor: holding the window for a restart")
                        lastHold = message
                        hold.show(update, giveUpAfter: 30)
                    }
                case "exiting":
                    let code = (message["code"] as? NSNumber)?.int32Value ?? 0
                    announcedExit = code
                    log("supervisor: \(child) is exiting with \(code)")
                    process.after(10, "exit-grace")
                case "failed":
                    let reason = (message["reason"] as? String) ?? "unknown"
                    log("supervisor: \(child) reported failure: \(reason)")
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
                case "stable" where pending == nil && !spawnedHead.isEmpty:
                    guard let git else { break }
                    do {
                        try git.run(["update-ref", Launcher.knownGoodRef, spawnedHead], cwd: paths.app)
                        log("supervisor: \(Int(options.stableSeconds))s stable; \(Launcher.knownGoodRef) = \(spawnedHead.prefix(12))")
                    } catch {
                        log("supervisor: could not mark known-good: \(error)")
                    }
                case "self-test-quit" where hydrationRunning:
                    // A self-test proves the whole install, hydration included.
                    process.after(0.5, "self-test-quit")
                case "self-test-quit", "shutdown":
                    log("supervisor: \(name == "shutdown" ? "Shut down" : "self-test") asks \(child) to quit")
                    quitRequested = true
                    process.send(["op": "quit"])
                    process.after(30, "quit-timeout")
                case "focus" where readyAt != nil:
                    // The same path as opening a second instance: Stella shows and focuses its window.
                    focusAsked += 1
                    focusPending = true
                    process.send(["op": "focus"])
                    process.after(1.5, "focus-timeout-\(focusAsked)")
                case let name where name.hasPrefix("focus-timeout-"):
                    // Only the latest ask counts: an earlier one's answer may still be on its way.
                    guard focusPending, name == "focus-timeout-\(focusAsked)" else { break }
                    focusPending = false
                    log("supervisor: \(child) didn't come forward; showing the launcher window")
                    ui.update(show: .front) { _ in }
                case "quit-timeout" where announcedExit == nil:
                    log("supervisor: \(child) did not quit in time; terminating")
                    process.terminate()
                case "exit-grace":
                    log("supervisor: \(child)'s teardown is still running 10s after it announced its exit; terminating")
                    teardownForced = true
                    process.terminate()
                default:
                    break
                }
            case let .exited(code, signal):
                if !process.drainOutputAfterExit() {
                    log("supervisor: \(child)'s output pipe is still held open by processes it started")
                }
                let output = process.output.lastLines
                let detail = signal != 0 ? "signal \(signal)" : "exit \(code)"
                log("supervisor: \(child) exited (\(detail))")
                if let pending { return .failed(pending.0, output) }
                if let announcedExit, teardownForced {
                    log("supervisor: \(child)'s teardown did not finish; its announced exit \(announcedExit) stands but cleanup is incomplete")
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

    private func adoptPrepared(_ message: [String: Any]) {
        var noted: [String] = []
        var lockHash: String?
        var preparedHead: String?
        if let hash = message["lockHash"] as? String,
           let actual = try? sha256File(paths.app.appendingPathComponent("bun.lock")),
           actual == hash {
            lockHash = actual
            noted.append("dependencies for lock \(actual.prefix(12))")
        }
        if let head = message["head"] as? String,
           let actual = try? git?.run(["rev-parse", "HEAD"], cwd: paths.app),
           actual == head {
            preparedHead = actual
            noted.append("setup for \(actual.prefix(12))")
        }
        guard !noted.isEmpty else { return }
        state.update(paths) {
            if let lockHash { $0.bunLockHash = lockHash }
            if let preparedHead { $0.preparedHead = preparedHead }
        }
        log("supervisor: Stella prepared \(noted.joined(separator: " and "))")
    }

    private func handleSign(_ message: [String: Any], process: ElectronProcess) {
        let id = message["id"] ?? NSNull()
        do {
            guard let git, let signer else { throw LauncherError("git is not set up yet.") }
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

    private func showOutsideChanges(_ changes: OutsideChanges) {
        hold.hide(after: 0)
        let facts = installFacts()
        ui.update(show: .front) {
            $0.phase = .changed
            $0.changes = changes.files
            $0.changesRoot = self.paths.app
            $0.hasKnownGood = facts.hasKnownGood
            $0.version = facts.version
        }
        ui.capture("changes.png", after: 0.6)
        if options.selfTest {
            log("launcher: self-test found files changed outside Stella")
            ui.perform("close", after: 1.5)
        }
    }

    private func acceptOutsideChanges() throws {
        guard let seen = outsideChanges else { return }
        outsideChanges = nil
        let (git, signer) = try tools()
        _ = try signer.acceptOutsideChanges(seen, git: git, app: paths.app)
    }

    private func recover(reason: String, output: [String], kind: FailureKind = .start, title: String = "") {
        recoveryCount += 1
        hold.hide(after: 0)
        log("launcher: failure: \(reason)")
        lastFailure = (reason, output)
        let facts = installFacts()
        let canRepair = kind == .start && !repairUsed && facts.version != ""
        ui.update(show: .front) {
            $0.phase = .failed
            $0.title = kind == .download ? "Couldn’t download Stella" : title
            $0.offerRecovery = kind == .start
            $0.canRepair = canRepair
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
            case .repair: ui.perform(canRepair ? "repair" : "close", after: 2)
            case .reinstall: ui.perform("reinstall", after: 2)
            case .retry: ui.perform("start", after: 2)
            case .quit: ui.perform("close", after: 2)
            }
        } else {
            log("launcher: self-test failed: \(reason)")
            ui.perform("close", after: 1.5)
        }
    }

    private var lastFailure: (reason: String, output: [String])?

    // MARK: - Repair
    //
    // One bounded pass of the user's own model at the checkout (packages/desktop/scripts/
    // launcher-repair.mjs, copied out of the last version that started so a broken checkout
    // can't break its own repair). It commits its fix; the launcher signs it and starts Stella.

    private func repair() -> (reason: String, output: [String], title: String)? {
        repairUsed = true
        let fail = { (message: String) -> (reason: String, output: [String], title: String) in
            log("repair: \(message)")
            return (message, [], "Repair didn’t work")
        }
        let fm = FileManager.default
        let work = paths.root.appendingPathComponent("repair")
        let git: GitTool, signer: TreeSigner, bunBin: URL
        do {
            (git, signer) = try tools()
            if let known = bun?.bin ?? runtimes?.bunBin {
                bunBin = known
            } else {
                bunBin = try Install.ensureBun(paths: paths, baseEnv: baseEnvironment(), localBun: options.localBun, progress: { _ in }).0
            }
            try fm.createDirectory(at: work, withIntermediateDirectories: true)
        } catch {
            return fail("Repair couldn’t set itself up: \(error)")
        }
        let app = paths.app
        let knownGood = hasKnownGood() ? ((try? git.run(["rev-parse", Launcher.knownGoodRef], cwd: app)) ?? "") : ""
        // The runner from the last version that started, else the current one.
        let script = work.appendingPathComponent("launcher-repair.mjs")
        var source = ""
        for ref in [knownGood, "HEAD"] where !ref.isEmpty {
            if let text = try? git.run(["show", "\(ref):packages/desktop/scripts/launcher-repair.mjs"], cwd: app), !text.isEmpty {
                source = ref == "HEAD" ? "HEAD" : String(ref.prefix(12))
                try? Data((text + "\n").utf8).write(to: script)
                break
            }
        }
        guard !source.isEmpty else { return fail("This version of Stella can’t repair itself.") }
        let failureFile = work.appendingPathComponent("failure.txt")
        let failureText = ([lastFailure?.reason ?? ""] + ["", "Output:"] + (lastFailure?.output ?? [])).joined(separator: "\n")
        try? Data(failureText.utf8).write(to: failureFile)
        let resultFile = work.appendingPathComponent("result.json")
        try? fm.removeItem(at: resultFile)
        let userData = paths.isolated
            ? paths.isolatedUserData
            : fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent(ElectronIdentity.appName)
        let electron = electronEnvironment()
        let dataDir = electron["STELLA_DATA_DIR"].flatMap { $0.isEmpty ? nil : $0 }
            ?? fm.homeDirectoryForCurrentUser.appendingPathComponent(".stella").path
        var env = baseEnvironment()
        for (key, value) in git.runtimeEnv { env[key] = value }
        if let server = electron["STELLA_LAUNCHER_SERVER_ID"] { env["STELLA_LAUNCHER_SERVER_ID"] = server }
        let timeout = Options.seconds("STELLA_LAUNCHER_REPAIR_SECONDS", 180)
        let args = [script.path, "--app", app.path, "--data-dir", dataDir, "--user-data", userData.path,
                    "--work", work.path, "--failure", failureFile.path, "--log", paths.electronLog.path,
                    "--known-good", knownGood, "--backend", backend, "--timeout", String(Int(timeout)),
                    "--result", resultFile.path]
        log("repair: running the repair from \(source) (\(Int(timeout))s)")
        let started = Date()
        do {
            _ = try Shell.run(bunBin.path, args, cwd: app, env: env,
                              outputFile: paths.logs.appendingPathComponent("repair.log"), timeout: timeout + 60)
        } catch {
            return fail("Repair ran out of time.")
        }
        guard let data = try? Data(contentsOf: resultFile),
              let result = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        else { return fail("Repair stopped without an answer.") }
        let message = (result["message"] as? String) ?? ""
        log("repair: \(result["route"] as? String ?? "?") finished in \(Int(Date().timeIntervalSince(started)))s: \(message)")
        guard result["ok"] as? Bool == true else { return fail(message.isEmpty ? "Repair couldn’t fix it." : message) }
        do {
            try signer.signHead(git: git, app: app, expected: nil)
        } catch {
            return fail("Repair couldn’t save its fix: \(error)")
        }
        repaired = true
        return nil
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
        var fresh = LauncherState()
        fresh.installedAt = ISO8601DateFormatter().string(from: Date())
        state.replace(fresh)
        state.update(paths) { _ in }
    }
}
