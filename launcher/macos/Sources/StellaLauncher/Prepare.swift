import CryptoKit
import Foundation

enum Prepare {
    static func run(
        paths: LauncherPaths,
        runtimes: Runtimes,
        env: [String: String],
        state: inout LauncherState,
        progress: (String) -> Void
    ) throws -> ElectronIdentity.Resolved {
        let app = paths.app
        let lockHash = try sha256File(app.appendingPathComponent("bun.lock"))
        let electronPackage = app.appendingPathComponent("node_modules/electron/package.json")
        if state.bunLockHash != lockHash || !FileManager.default.fileExists(atPath: electronPackage.path) {
            progress("Installing Stella's dependencies…")
            log("prepare: bun install --frozen-lockfile (lock \(lockHash.prefix(12)))")
            let started = Date()
            var installEnv = env
            installEnv["STELLA_SKIP_BROWSER_HYDRATE"] = "1"
            installEnv["STELLA_SKIP_OFFICE_HYDRATE"] = "1"
            let result = try Shell.run(runtimes.bunBin.path, ["install", "--frozen-lockfile"],
                                       cwd: app, env: installEnv, outputFile: paths.installLog,
                                       timeout: 30 * 60)
            guard result.code == 0 else {
                throw LauncherError("bun install failed (exit \(result.code)):\n\(lastLines(result.stderr, 20))")
            }
            log("prepare: bun install finished in \(Int(Date().timeIntervalSince(started)))s")
            state.bunLockHash = lockHash
            state.save(paths)
        }

        let head = try runtimes.git.run(["rev-parse", "HEAD"], cwd: app)
        let script = app.appendingPathComponent("packages/desktop/scripts/prepare-install.mjs")
        if state.preparedHead != head, FileManager.default.fileExists(atPath: script.path) {
            progress("Preparing Stella…")
            log("prepare: prepare-install.mjs for \(head.prefix(12))")
            let timeout = Options.seconds("STELLA_LAUNCHER_PREPARE_TIMEOUT_SECONDS", 10 * 60)
            let result = try? Shell.run(runtimes.bunBin.path, [script.path],
                                        cwd: app, env: env, outputFile: paths.installLog, timeout: timeout)
            if let result, result.code == 0 {
                state.preparedHead = head
                state.save(paths)
            } else {
                let detail = result.map { "exit \($0.code)" } ?? "timed out after \(Int(timeout))s"
                log("prepare: prepare-install.mjs incomplete (\(detail)):\n\(lastLines(result?.stderr ?? "", 10))")
            }
        }

        return try ElectronIdentity.ensure(paths: paths, env: env, progress: progress)
    }

    static func lastLines(_ text: String, _ count: Int) -> String {
        text.split(separator: "\n", omittingEmptySubsequences: false).suffix(count).joined(separator: "\n")
    }
}

/// `bundles/electron-<v>/Stella.app`: Electron as macOS knows Stella (bundle
/// id, name, icon, microphone string), the Developer ID-signed copy CI
/// publishes per Electron version (.github/workflows/build-electron-identity.yml).
/// Its identity is the same across versions and reinstalls, so the Keychain
/// item and privacy grants keep trusting it.
///
/// macOS ties those grants to the signature, so the launcher never switches
/// to an unsigned copy on its own. When the signed copy for this Electron
/// can't be downloaded, it keeps running the newest signed copy it already
/// has and retries in the background; with none, it stops with
/// `DownloadFailure` (the "Couldn't download Stella" screen). A local ad-hoc
/// copy is built only when a developer sets `STELLA_LAUNCHER_UNSIGNED_ELECTRON=1`.
enum ElectronIdentity {
    struct Resolved {
        let app: URL
        /// The Electron version whose signed copy is still missing, when `app`
        /// is an older signed copy standing in for it.
        let pendingVersion: String?
    }

    struct DownloadFailure: Error, CustomStringConvertible {
        let version: String
        let underlying: String
        var description: String {
            "Stella couldn't download its signed app (Electron \(version)): \(underlying)"
        }
    }

    static let bundleId = "com.stella.app"
    static let appName = "Stella"
    static let microphoneUsage = "Stella uses your microphone for voice conversations."
    static let plistPatch: KeyValuePairs<String, String> = [
        // Electron decides app.isPackaged from the executable name; launcher runs are source runs.
        "CFBundleExecutable": "Electron",
        "CFBundleName": appName,
        "CFBundleDisplayName": appName,
        "CFBundleIdentifier": bundleId,
        "NSMicrophoneUsageDescription": microphoneUsage,
    ]
    static var plistPatchDigest: String {
        let canonical = plistPatch.map { "\($0.key)=\($0.value)" }.joined(separator: "\n")
        return SHA256.hash(data: Data(canonical.utf8)).map { String(format: "%02x", $0) }.joined()
    }
    static var signedBase: String {
        let override = ProcessInfo.processInfo.environment["STELLA_LAUNCHER_ELECTRON_IDENTITY_URL"]?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return override.isEmpty ? "\(Deployment.releasesURL)/electron-identity" : override
    }
    static let requirement =
        "anchor apple generic and identifier \"com.stella.app\" and certificate leaf[subject.OU] = \"\(Deployment.appleTeamID)\""
    #if arch(arm64)
    static let arch = "arm64"
    #else
    static let arch = "x64"
    #endif

    static var unsignedOptIn: Bool {
        ProcessInfo.processInfo.environment["STELLA_LAUNCHER_UNSIGNED_ELECTRON"]?
            .trimmingCharacters(in: .whitespacesAndNewlines) == "1"
    }

    /// Serializes installs between a launch and the background retry.
    private static let installLock = NSLock()

    static func signedMarker(_ version: String) -> String { "{\"electron\":\"\(version)\",\"signed\":true}" }

    static func installedVersion(app: URL) throws -> (version: String, source: URL) {
        let electronDir = app.appendingPathComponent("node_modules/electron").resolvingSymlinksInPath()
        let packageData = try Data(contentsOf: electronDir.appendingPathComponent("package.json"))
        guard let package = try JSONSerialization.jsonObject(with: packageData) as? [String: Any],
              let version = package["version"] as? String
        else { throw LauncherError("Could not read the installed Electron version.") }
        return (version, electronDir.appendingPathComponent("dist/Electron.app"))
    }

    static func ensure(paths: LauncherPaths, env: [String: String], progress: (String) -> Void) throws -> Resolved {
        let (version, source) = try installedVersion(app: paths.app)
        installLock.lock()
        defer { installLock.unlock() }
        if let ready = signedCopy(paths: paths, version: version) {
            return Resolved(app: ready, pendingVersion: nil)
        }
        let failure: String
        do {
            return Resolved(app: try downloadSigned(paths: paths, version: version, env: env, progress: progress),
                            pendingVersion: nil)
        } catch {
            failure = "\(error)"
            log("identity: signed Stella.app for Electron \(version) unavailable: \(failure)")
        }
        if unsignedOptIn {
            log("identity: STELLA_LAUNCHER_UNSIGNED_ELECTRON=1; using a local ad-hoc copy (macOS permissions and Keychain access won't carry over)")
            return Resolved(app: try buildAdHoc(paths: paths, version: version, source: source, env: env, progress: progress),
                            pendingVersion: nil)
        }
        if let (older, olderVersion) = newestSignedCopy(paths: paths) {
            log("identity: keeping the signed Stella.app for Electron \(olderVersion) until \(version) downloads")
            return Resolved(app: older, pendingVersion: version)
        }
        throw DownloadFailure(version: version, underlying: failure)
    }

    /// Background retry for a launch that fell back to an older signed copy.
    /// The new copy lands in its own folder and is used from the next launch.
    static func retryDownload(paths: LauncherPaths, version: String, env: [String: String]) -> Bool {
        installLock.lock()
        defer { installLock.unlock() }
        if signedCopy(paths: paths, version: version) != nil { return true }
        do {
            _ = try downloadSigned(paths: paths, version: version, env: env, progress: { _ in })
            return true
        } catch {
            log("identity: retry for Electron \(version) failed: \(error)")
            return false
        }
    }

    private static func signedCopy(paths: LauncherPaths, version: String) -> URL? {
        let dir = paths.bundles.appendingPathComponent("electron-\(version)")
        let target = dir.appendingPathComponent("Stella.app")
        let marker = try? String(contentsOf: dir.appendingPathComponent("identity.json"), encoding: .utf8)
        guard marker == signedMarker(version),
              FileManager.default.fileExists(atPath: target.appendingPathComponent("Contents/MacOS/Electron").path)
        else { return nil }
        return target
    }

    private static func newestSignedCopy(paths: LauncherPaths) -> (URL, String)? {
        let entries = (try? FileManager.default.contentsOfDirectory(atPath: paths.bundles.path)) ?? []
        let versions = entries.compactMap { name -> String? in
            name.hasPrefix("electron-") ? String(name.dropFirst("electron-".count)) : nil
        }
        let sorted = versions.sorted { $0.compare($1, options: .numeric) == .orderedDescending }
        for version in sorted {
            if let app = signedCopy(paths: paths, version: version) { return (app, version) }
        }
        return nil
    }

    private static func downloadSigned(
        paths: LauncherPaths, version: String, env: [String: String], progress: (String) -> Void
    ) throws -> URL {
        let dir = paths.bundles.appendingPathComponent("electron-\(version)")
        let target = dir.appendingPathComponent("Stella.app")
        let marker = dir.appendingPathComponent("identity.json")
        try installSigned(version: version, dir: dir, target: target, env: env, progress: progress)
        try signedMarker(version).write(to: marker, atomically: true, encoding: .utf8)
        log("identity: \(target.path) ready (Developer ID)")
        return target
    }

    private static func buildAdHoc(
        paths: LauncherPaths, version: String, source: URL, env: [String: String], progress: (String) -> Void
    ) throws -> URL {
        let app = paths.app
        guard FileManager.default.fileExists(atPath: source.appendingPathComponent("Contents/MacOS/Electron").path) else {
            throw LauncherError("Electron \(version) is not installed (missing \(source.path)).")
        }
        let icon = app.appendingPathComponent("packages/desktop/build/icon.icns")
        let iconHash = (try? sha256File(icon)) ?? "none"
        let dir = paths.bundles.appendingPathComponent("electron-\(version)")
        let target = dir.appendingPathComponent("Stella.app")
        let marker = dir.appendingPathComponent("identity.json")
        let expected = "{\"electron\":\"\(version)\",\"icon\":\"\(iconHash)\",\"plist\":\"\(plistPatchDigest)\"}"
        if FileManager.default.fileExists(atPath: target.path),
           (try? String(contentsOf: marker, encoding: .utf8)) == expected {
            return target
        }

        progress("Setting up Stella.app…")
        log("identity: building \(target.path) from Electron \(version) (ad-hoc)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let staging = dir.appendingPathComponent("Stella.app.partial")
        try? FileManager.default.removeItem(at: staging)
        let copy = try Shell.run("/usr/bin/ditto", [source.path, staging.path], env: env)
        guard copy.code == 0 else { throw LauncherError("Could not copy Electron.app: \(copy.stderr)") }

        let plistURL = staging.appendingPathComponent("Contents/Info.plist")
        let plistData = try Data(contentsOf: plistURL)
        var format = PropertyListSerialization.PropertyListFormat.xml
        guard var plist = try PropertyListSerialization.propertyList(
            from: plistData, options: [], format: &format) as? [String: Any]
        else { throw LauncherError("Electron's Info.plist is unreadable.") }
        for (key, value) in plistPatch {
            plist[key] = value
        }
        let patched = try PropertyListSerialization.data(fromPropertyList: plist, format: format, options: 0)
        try patched.write(to: plistURL)

        if FileManager.default.fileExists(atPath: icon.path) {
            let targetIcon = staging.appendingPathComponent("Contents/Resources/electron.icns")
            try? FileManager.default.removeItem(at: targetIcon)
            try FileManager.default.copyItem(at: icon, to: targetIcon)
        }

        let sign = try Shell.run("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", staging.path], env: env)
        guard sign.code == 0 else { throw LauncherError("codesign failed: \(sign.stderr)") }

        try? FileManager.default.removeItem(at: target)
        try FileManager.default.moveItem(at: staging, to: target)
        try expected.write(to: marker, atomically: true, encoding: .utf8)
        log("identity: \(target.path) ready (ad-hoc)")
        return target
    }

    private static func installSigned(
        version: String, dir: URL, target: URL, env: [String: String], progress: (String) -> Void
    ) throws {
        let name = "Stella-darwin-\(arch).zip"
        guard let sumURL = URL(string: "\(signedBase)/\(version)/\(name).sha256"),
              let zipURL = URL(string: "\(signedBase)/\(version)/\(name)")
        else { throw LauncherError("Bad signed bundle URL.") }
        let (sumData, sumResponse) = try Net.fetch(URLRequest(url: sumURL))
        guard sumResponse.statusCode == 200 else { throw LauncherError("HTTP \(sumResponse.statusCode) for \(name).sha256") }
        let sha = String(decoding: sumData, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        progress("Setting up Stella.app…")
        log("identity: downloading signed Stella.app for Electron \(version)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let zip = dir.appendingPathComponent(name)
        try Net.download(zipURL, to: zip, sha256: sha)
        defer { try? FileManager.default.removeItem(at: zip) }
        let unpacked = dir.appendingPathComponent("signed.partial")
        try? FileManager.default.removeItem(at: unpacked)
        let unzip = try Shell.run("/usr/bin/ditto", ["-x", "-k", zip.path, unpacked.path], env: env)
        guard unzip.code == 0 else { throw LauncherError("Could not unpack \(name): \(unzip.stderr)") }
        defer { try? FileManager.default.removeItem(at: unpacked) }
        let app = unpacked.appendingPathComponent("Stella.app")
        let verify = try Shell.run(
            "/usr/bin/codesign", ["--verify", "--deep", "--strict", "-R=\(requirement)", app.path], env: env)
        guard verify.code == 0 else { throw LauncherError("Signature check failed: \(verify.stderr)") }
        try? FileManager.default.removeItem(at: target)
        try FileManager.default.moveItem(at: app, to: target)
    }
}
