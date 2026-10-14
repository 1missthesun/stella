import AppKit
import Darwin
import Foundation

enum InstanceLock {
    private static var fd: Int32 = -1

    static func acquire(_ url: URL, wait: TimeInterval) -> Bool {
        if fd < 0 { fd = open(url.path, O_CREAT | O_RDWR | O_CLOEXEC, 0o600) }
        guard fd >= 0 else { return false }
        let deadline = Date().addingTimeInterval(wait)
        while flock(fd, LOCK_EX | LOCK_NB) != 0 {
            if Date() >= deadline { return false }
            usleep(100_000)
        }
        return true
    }

    static func release() {
        if fd >= 0 { flock(fd, LOCK_UN) }
    }
}

final class LauncherUpdater {
    static let defaultBase = "\(Deployment.releasesURL)/launcher/stable"
    static let asset = "Stella-macos.zip"
    static let requirement =
        "anchor apple generic and certificate leaf[subject.OU] = \"\(Deployment.appleTeamID)\" and identifier \"com.stella.launcher\""
    static let interval: TimeInterval = 6 * 60 * 60

    static var ownVersion: Int {
        (Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String)
            .flatMap { Int($0.trimmingCharacters(in: .whitespaces)) } ?? 0
    }

    private let paths: LauncherPaths
    private let base: String?
    private let requirement: String
    private let queue = DispatchQueue(label: "launcher-update", qos: .utility)
    private let lock = NSLock()
    private var staged: Int?
    private var stopped = false
    private let firstCheck = DispatchGroup()
    private var firstOutcome: CheckOutcome?
    private var progressHandler: ((String, Double, Double) -> Void)?
    private var lastProgress: (String, Double, Double)?

    enum CheckOutcome {
        case off
        case current
        case staged(Int)
        case failed(String)
        case timedOut
    }

    private var work: URL { paths.root.appendingPathComponent("launcher-update") }
    private var previousDir: URL { paths.root.appendingPathComponent("launcher-previous") }
    var holdFile: URL { paths.root.appendingPathComponent("launcher-handover-hold.json") }

    init(paths: LauncherPaths, selfTest: Bool) {
        self.paths = paths
        let env = ProcessInfo.processInfo.environment
        let override = (env["STELLA_LAUNCHER_UPDATE_URL"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if !override.isEmpty {
            base = override.hasSuffix("/") ? String(override.dropLast()) : override
            let testRequirement = (env["STELLA_LAUNCHER_UPDATE_REQUIREMENT"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            requirement = testRequirement.isEmpty ? Self.requirement : testRequirement
        } else {
            base = Self.ownVersion == 0 || selfTest || paths.isolated ? nil : Self.defaultBase
            requirement = Self.requirement
        }
    }

    var stagedVersion: Int? {
        lock.lock()
        defer { lock.unlock() }
        return staged
    }

    func start() {
        guard let base else {
            log("update: off (version \(Self.ownVersion))")
            return
        }
        let delay = Options.seconds("STELLA_LAUNCHER_UPDATE_DELAY_SECONDS", 0)
        log("update: version \(Self.ownVersion); checking \(base) in \(Int(delay))s, then every \(Int(Self.interval / 3600))h")
        firstCheck.enter()
        schedule(after: delay)
    }

    func waitForFirstCheck(timeout: TimeInterval, progress: @escaping (String, Double, Double) -> Void) -> CheckOutcome {
        guard base != nil else { return .off }
        lock.lock()
        let replay = lastProgress
        progressHandler = progress
        lock.unlock()
        if let replay { progress(replay.0, replay.1, replay.2) }
        let finished = firstCheck.wait(timeout: .now() + timeout) == .success
        lock.lock()
        progressHandler = nil
        let outcome = firstOutcome
        lock.unlock()
        guard finished, let outcome else { return .timedOut }
        if case .current = outcome, let staged = stagedVersion { return .staged(staged) }
        return outcome
    }

    private func report(_ status: String, _ from: Double, _ to: Double) {
        lock.lock()
        lastProgress = (status, from, to)
        let handler = progressHandler
        lock.unlock()
        handler?(status, from, to)
    }

    func startedSuccessfully() {
        queue.async { [self] in
            guard stagedVersion == nil, FileManager.default.fileExists(atPath: previousDir.path) else { return }
            do {
                try FileManager.default.removeItem(at: previousDir)
                log("update: removed the previous launcher")
            } catch {
                log("update: could not remove the previous launcher: \(error)")
            }
        }
    }

    private func schedule(after delay: TimeInterval) {
        queue.asyncAfter(wallDeadline: .now() + delay) { [self] in
            let outcome = check()
            lock.lock()
            let first = firstOutcome == nil
            if first { firstOutcome = outcome }
            lastProgress = nil
            lock.unlock()
            if first { firstCheck.leave() }
            if !stopped { schedule(after: Self.interval) }
        }
    }

    private func check() -> CheckOutcome {
        guard let base else { return .off }
        let fm = FileManager.default
        let bundle = Bundle.main.bundleURL
        guard bundle.pathExtension == "app" else {
            log("update: not running from an app bundle (\(bundle.path)); not updating")
            stopped = true
            return .off
        }
        guard fm.isWritableFile(atPath: bundle.path),
              fm.isWritableFile(atPath: bundle.deletingLastPathComponent().path)
        else {
            log("update: \(bundle.path) is not writable; not updating this run")
            stopped = true
            return .off
        }

        log("update: checking")
        do {
            let latest = try fetchVersion(base)
            let current = max(Self.ownVersion, stagedVersion ?? 0)
            guard latest > current else {
                log("update: up to date (latest \(latest), have \(current))")
                return .current
            }
            log("update: \(latest) available")
            report("Downloading the update…", 0.05, 0.6)
            try? fm.removeItem(at: work)
            try fm.createDirectory(at: work, withIntermediateDirectories: true)
            defer { try? fm.removeItem(at: work) }

            let sha = try expectedSHA(base)
            guard let zipURL = URL(string: "\(base)/\(Self.asset)") else { throw LauncherError("bad update URL") }
            let zip = work.appendingPathComponent(Self.asset)
            try Net.download(zipURL, to: zip, sha256: sha)
            log("update: downloaded \(latest) (sha256 \(sha.prefix(12)))")
            report("Installing the update…", 0.6, 0.85)
            let unpacked = work.appendingPathComponent("unpacked")
            let unzip = try Shell.run("/usr/bin/ditto", ["-x", "-k", zip.path, unpacked.path], env: Self.toolEnv, timeout: 300)
            guard unzip.code == 0 else { throw LauncherError("could not unpack \(Self.asset): \(Self.trim(unzip.stderr))") }
            let app = unpacked.appendingPathComponent("Stella.app")
            guard fm.fileExists(atPath: app.path) else { throw LauncherError("\(Self.asset) has no Stella.app") }

            try verify(app, version: latest)
            log("update: verified \(latest)")
            report("Installing the update…", 0.85, 0.95)
            try stage(app, version: latest, at: bundle)
            log("update: staged \(latest) at \(bundle.path); the previous launcher is in \(previousDir.path)")
            return .staged(latest)
        } catch let error as StageRefused {
            log("update: \(error.description); not updating this run")
            stopped = true
            return .failed(error.description)
        } catch {
            log("update: failed: \(error)")
            return .failed("\(error)")
        }
    }

    private func fetchVersion(_ base: String) throws -> Int {
        let text = try fetchText("\(base)/VERSION")
        guard let version = Int(text.trimmingCharacters(in: .whitespacesAndNewlines)) else {
            throw LauncherError("VERSION is not a number: \(text.prefix(40))")
        }
        return version
    }

    private func expectedSHA(_ base: String) throws -> String {
        let sums = try fetchText("\(base)/SHA256SUMS")
        for line in sums.split(whereSeparator: \.isNewline) {
            let fields = line.split(maxSplits: 1, whereSeparator: \.isWhitespace)
            guard fields.count == 2 else { continue }
            var name = fields[1].trimmingCharacters(in: .whitespaces)
            if name.hasPrefix("*") { name.removeFirst() }
            let hash = fields[0].lowercased()
            if name == Self.asset, hash.count == 64, hash.allSatisfy(\.isHexDigit) { return hash }
        }
        throw LauncherError("SHA256SUMS has no \(Self.asset)")
    }

    private func fetchText(_ address: String) throws -> String {
        guard let url = URL(string: address) else { throw LauncherError("bad URL \(address)") }
        var request = URLRequest(url: url)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        let (data, response) = try Net.fetch(request)
        guard response.statusCode == 200 else { throw LauncherError("HTTP \(response.statusCode) for \(url.lastPathComponent)") }
        return String(decoding: data, as: UTF8.self)
    }

    private func verify(_ app: URL, version: Int) throws {
        let sign = try Shell.run(
            "/usr/bin/codesign", ["--verify", "--deep", "--strict", "-R=\(requirement)", app.path],
            env: Self.toolEnv, timeout: 120)
        guard sign.code == 0 else { throw LauncherError("signature check failed: \(Self.trim(sign.stderr))") }
        let executable = app.appendingPathComponent("Contents/MacOS/StellaLauncher")
        let probe = try Shell.run(executable.path, ["--version"], env: Self.toolEnv, timeout: 30)
        let reported = probe.stdout.trimmingCharacters(in: .whitespacesAndNewlines)
        guard probe.code == 0, reported == String(version) else {
            throw LauncherError("the new launcher's --version said \"\(reported.prefix(40))\" (exit \(probe.code)), expected \(version)")
        }
    }

    private struct StageRefused: Error, CustomStringConvertible {
        let description: String
    }

    private func stage(_ app: URL, version: Int, at bundle: URL) throws {
        let fm = FileManager.default
        lock.lock()
        defer { lock.unlock() }
        let aside: URL
        if staged == nil {
            try? fm.removeItem(at: previousDir)
            try fm.createDirectory(at: previousDir, withIntermediateDirectories: true)
            aside = previousDir.appendingPathComponent("Stella.app")
        } else {
            aside = work.appendingPathComponent("replaced.app")
        }
        do {
            try fm.moveItem(at: bundle, to: aside)
        } catch {
            throw StageRefused(description: "could not move \(bundle.path) aside: \(error.localizedDescription)")
        }
        do {
            try fm.moveItem(at: app, to: bundle)
        } catch {
            if (try? fm.moveItem(at: aside, to: bundle)) == nil {
                log("update: could not put \(aside.path) back at \(bundle.path)")
            }
            throw LauncherError("could not move the update into \(bundle.path): \(error.localizedDescription)")
        }
        staged = version
    }

    func handOver(to version: Int, hold: [String: Any]?, showWindow: Bool = false) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        log("update: handing over to \(version)")
        let bundle = Bundle.main.bundleURL
        var args = showWindow ? ["--start", "--show"] : ["--start"]
        if let hold, JSONSerialization.isValidJSONObject(hold),
           let data = try? JSONSerialization.data(withJSONObject: hold),
           (try? data.write(to: holdFile, options: .atomic)) != nil {
            args += ["--hold-window", holdFile.path]
        }
        let config = NSWorkspace.OpenConfiguration()
        config.createsNewApplicationInstance = true
        config.activates = false
        config.addsToRecentItems = false
        config.arguments = args
        config.environment = ProcessInfo.processInfo.environment.filter { $0.key.hasPrefix("STELLA_") }

        InstanceLock.release()
        let opened = DispatchSemaphore(value: 0)
        var failure: Error?
        DispatchQueue.main.async {
            NSWorkspace.shared.openApplication(at: bundle, configuration: config) { app, error in
                if let error {
                    failure = error
                } else if let app {
                    log("update: launcher \(version) started as pid \(app.processIdentifier)")
                }
                opened.signal()
            }
        }
        if opened.wait(timeout: .now() + 20) == .timedOut {
            failure = LauncherError("no answer from Launch Services within 20s")
        }
        if let failure {
            log("update: handover to \(version) failed: \(failure)")
            guard InstanceLock.acquire(paths.lockFile, wait: 0) else {
                log("update: the new launcher took the lock anyway; leaving Stella to it")
                return true
            }
            try? FileManager.default.removeItem(at: holdFile)
            return false
        }
        Thread.sleep(forTimeInterval: 2)
        return true
    }

    private static let toolEnv = ["PATH": "/usr/bin:/bin:/usr/sbin:/sbin"]

    private static func trim(_ text: String) -> String {
        String(text.trimmingCharacters(in: .whitespacesAndNewlines).suffix(400))
    }
}
