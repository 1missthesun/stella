import Foundation

struct GitTool {
    let bin: String
    let root: URL?
    let baseEnv: [String: String]
    var ceiling: String? = nil

    var runtimeEnv: [String: String] {
        guard let root else { return ["STELLA_GIT_BIN": bin] }
        return [
            "STELLA_GIT_BIN": bin,
            "LOCAL_GIT_DIRECTORY": root.path,
            "GIT_EXEC_PATH": root.appendingPathComponent("libexec/git-core").path,
            "GIT_TEMPLATE_DIR": root.appendingPathComponent("share/git-core/templates").path,
        ]
    }

    func raw(_ args: [String], cwd: URL?, extraEnv: [String: String] = [:]) throws -> ShellResult {
        var env = baseEnv
        for (key, value) in runtimeEnv where key != "STELLA_GIT_BIN" && key != "LOCAL_GIT_DIRECTORY" {
            env[key] = value
        }
        env["GIT_TERMINAL_PROMPT"] = "0"
        // An app folder without .git (a first install's app bundle, before
        // hydration) must not find a repository above it.
        if let ceiling { env["GIT_CEILING_DIRECTORIES"] = ceiling }
        for (key, value) in extraEnv { env[key] = value }
        return try Shell.run(bin, args, cwd: cwd, env: env)
    }

    @discardableResult
    func run(_ args: [String], cwd: URL?, extraEnv: [String: String] = [:]) throws -> String {
        let result = try raw(args, cwd: cwd, extraEnv: extraEnv)
        guard result.code == 0 else {
            let detail = result.stderr.trimmingCharacters(in: .whitespacesAndNewlines)
            throw LauncherError("git \(args.first ?? "") failed: \(detail.isEmpty ? "exit \(result.code)" : detail)")
        }
        return result.stdout.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static let identityEnv: [String: String] = [
        "GIT_AUTHOR_NAME": "Stella",
        "GIT_AUTHOR_EMAIL": "stella@localhost",
        "GIT_COMMITTER_NAME": "Stella",
        "GIT_COMMITTER_EMAIL": "stella@localhost",
    ]
}

struct Runtimes {
    let bunBin: URL
    let bunVersion: String
    let git: GitTool
}

enum Install {
    /// The pinned git runtime, where ensureGit puts it (whether or not it is there yet).
    static func plannedGit(paths: LauncherPaths, baseEnv: [String: String]) -> GitTool {
        let root = paths.runtimes.appendingPathComponent("git-\(Pins.gitVersion)")
        return GitTool(bin: root.appendingPathComponent("bin/git").path, root: root, baseEnv: baseEnv,
                       ceiling: paths.root.path)
    }

    static func ensureGit(paths: LauncherPaths, baseEnv: [String: String], progress: (String) -> Void) throws -> GitTool {
        gitLock.lock()
        defer { gitLock.unlock() }
        let planned = plannedGit(paths: paths, baseEnv: baseEnv)
        guard let root = planned.root else { return planned }
        let bin = URL(fileURLWithPath: planned.bin)
        if FileManager.default.isExecutableFile(atPath: bin.path) {
            return planned
        }
        guard let asset = Pins.git[Pins.platformKey], let url = URL(string: asset.url) else {
            throw LauncherError("No git runtime for \(Pins.platformKey).")
        }
        progress("Downloading git \(Pins.gitVersion)…")
        log("install: downloading git \(Pins.gitVersion) from \(asset.url)")
        try FileManager.default.createDirectory(at: paths.runtimes, withIntermediateDirectories: true)
        let archive = paths.runtimes.appendingPathComponent("git-\(Pins.gitVersion).tar.gz")
        try Net.download(url, to: archive, sha256: asset.sha256)
        let staging = paths.runtimes.appendingPathComponent(".git-\(Pins.gitVersion).partial")
        try? FileManager.default.removeItem(at: staging)
        try FileManager.default.createDirectory(at: staging, withIntermediateDirectories: true)
        let untar = try Shell.run("/usr/bin/tar", ["-xzf", archive.path, "-C", staging.path], env: baseEnv)
        guard untar.code == 0 else { throw LauncherError("Could not unpack git: \(untar.stderr)") }
        try? FileManager.default.removeItem(at: archive)
        try? FileManager.default.removeItem(at: root)
        try FileManager.default.moveItem(at: staging, to: root)
        log("install: git ready: \(try planned.run(["--version"], cwd: nil))")
        return planned
    }

    /// Hydration's thread and the launcher's may both want git.
    private static let gitLock = NSLock()

    static func ensureBun(paths: LauncherPaths, baseEnv: [String: String], localBun: String?, progress: (String) -> Void) throws -> (URL, String) {
        var version = Pins.bunVersion
        var asset = Pins.bun[Pins.platformKey]
        if let requested = requestedBun(paths: paths) {
            version = requested.0
            asset = requested.1
        }

        if let localBun {
            let probe = try Shell.run(localBun, ["--version"], env: baseEnv)
            let localVersion = probe.stdout.trimmingCharacters(in: .whitespacesAndNewlines)
            guard probe.code == 0, !localVersion.isEmpty else { throw LauncherError("\(localBun) is not a working bun.") }
            let dir = paths.runtimes.appendingPathComponent("bun-\(localVersion)")
            let bin = dir.appendingPathComponent("bun")
            if !FileManager.default.isExecutableFile(atPath: bin.path) {
                try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                try FileManager.default.copyItem(at: URL(fileURLWithPath: localBun).resolvingSymlinksInPath(), to: bin)
                log("install: adopted local bun \(localVersion) from \(localBun)")
            }
            return (bin, localVersion)
        }

        bunLock.lock()
        defer { bunLock.unlock() }
        let dir = paths.runtimes.appendingPathComponent("bun-\(version)")
        let bin = dir.appendingPathComponent("bun")
        if FileManager.default.isExecutableFile(atPath: bin.path) {
            return (bin, version)
        }
        guard let asset else {
            throw LauncherError("No Bun \(version) for \(Pins.platformKey).")
        }
        progress("Downloading Bun \(version)…")
        return try installBun(paths: paths, baseEnv: baseEnv, version: version, asset: asset)
    }

    private static let bunLock = NSLock()

    /// The launcher's own Bun pin is almost always the one the app source
    /// asks for, so a first install fetches it while git clones. ensureBun
    /// waits on bunLock for it.
    static func prefetchBun(paths: LauncherPaths, baseEnv: [String: String], localBun: String?) {
        guard localBun == nil, let asset = Pins.bun[Pins.platformKey] else { return }
        let version = Pins.bunVersion
        let bin = paths.runtimes.appendingPathComponent("bun-\(version)/bun")
        if FileManager.default.isExecutableFile(atPath: bin.path) { return }
        let ready = DispatchSemaphore(value: 0)
        Thread.detachNewThread {
            bunLock.lock()
            ready.signal()
            defer { bunLock.unlock() }
            if FileManager.default.isExecutableFile(atPath: bin.path) { return }
            do {
                _ = try installBun(paths: paths, baseEnv: baseEnv, version: version, asset: asset)
            } catch {
                log("install: early bun download failed (\(error)); trying again after the clone")
            }
        }
        ready.wait()
    }

    private static func installBun(
        paths: LauncherPaths, baseEnv: [String: String], version: String, asset: Pins.Asset
    ) throws -> (URL, String) {
        let dir = paths.runtimes.appendingPathComponent("bun-\(version)")
        let bin = dir.appendingPathComponent("bun")
        guard let url = URL(string: asset.url) else { throw LauncherError("Bad Bun URL \(asset.url).") }
        log("install: downloading bun \(version) from \(asset.url)")
        try FileManager.default.createDirectory(at: paths.runtimes, withIntermediateDirectories: true)
        let archive = paths.runtimes.appendingPathComponent("bun-\(version).zip")
        try Net.download(url, to: archive, sha256: asset.sha256)
        let staging = paths.runtimes.appendingPathComponent(".bun-\(version).partial")
        try? FileManager.default.removeItem(at: staging)
        let unzip = try Shell.run("/usr/bin/ditto", ["-x", "-k", archive.path, staging.path], env: baseEnv)
        guard unzip.code == 0 else { throw LauncherError("Could not unpack bun: \(unzip.stderr)") }
        let member = staging.appendingPathComponent(asset.member ?? "bun")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try? FileManager.default.removeItem(at: bin)
        try FileManager.default.moveItem(at: member, to: bin)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: bin.path)
        try? FileManager.default.removeItem(at: staging)
        try? FileManager.default.removeItem(at: archive)
        log("install: bun \(version) ready")
        return (bin, version)
    }

    /// launcher.json "stellaEngine": {"version", "assets": {<platform>: {"url", "sha256", "member"?, "app"?}}};
    /// an asset without "member" is the bare binary, one with it is a zip holding it. One with "app"
    /// is a zip holding the signed Stella.app whose Contents/MacOS/stella-engine is the engine: the
    /// bundle gives it Stella's identity (TCC grants, Dock, menu bar, notifications).
    static func ensureEngine(paths: LauncherPaths, localBin: String?, progress: (String) -> Void) throws -> (bin: URL, version: String) {
        let fm = FileManager.default
        let host = paths.app.appendingPathComponent("packages/desktop-rune/host/main.tsx")
        guard fm.fileExists(atPath: host.path) else {
            throw LauncherError("This version of Stella has no Rune app (\(host.path) is missing).")
        }
        if let localBin {
            guard fm.isExecutableFile(atPath: localBin) else { throw LauncherError("\(localBin) is not an executable stella-engine.") }
            return (URL(fileURLWithPath: localBin), "local")
        }
        engineLock.lock()
        defer { engineLock.unlock() }
        return try installEngine(paths: paths, progress: progress)
    }

    private static let engineLock = NSLock()

    /// Whether this source can run on the Rune engine here: it has the Rune app and its launcher.json
    /// pins a stella-engine build for this platform. Sources from before Rune start Electron.
    static func engineAvailable(paths: LauncherPaths) -> Bool {
        let host = paths.app.appendingPathComponent("packages/desktop-rune/host/main.tsx")
        guard FileManager.default.fileExists(atPath: host.path),
              let data = try? Data(contentsOf: paths.app.appendingPathComponent("packages/desktop/launcher.json")),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let engine = json["stellaEngine"] as? [String: Any],
              engine["version"] is String,
              let entry = (engine["assets"] as? [String: Any])?[Pins.platformKey] as? [String: Any]
        else { return false }
        return entry["url"] is String && entry["sha256"] is String
    }

    /// A first install fetches the engine while dependencies install. It
    /// starts once the source is verified, since the engine's URL and checksum
    /// come from that source's launcher.json; ensureEngine waits on
    /// engineLock for it.
    static func prefetchEngine(paths: LauncherPaths) {
        let ready = DispatchSemaphore(value: 0)
        Thread.detachNewThread {
            engineLock.lock()
            ready.signal()
            defer { engineLock.unlock() }
            do {
                _ = try installEngine(paths: paths, progress: { _ in })
            } catch {
                log("install: early stella-engine download failed (\(error)); trying again")
            }
        }
        ready.wait()
    }

    private static func installEngine(paths: LauncherPaths, progress: (String) -> Void) throws -> (bin: URL, version: String) {
        let manifest = paths.app.appendingPathComponent("packages/desktop/launcher.json")
        guard let data = try? Data(contentsOf: manifest),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let engine = json["stellaEngine"] as? [String: Any],
              let version = engine["version"] as? String,
              let entry = (engine["assets"] as? [String: Any])?[Pins.platformKey] as? [String: Any]
        else { throw LauncherError("This version of Stella has no Rune engine for \(Pins.platformKey).") }
        return try installEngineAsset(paths: paths, version: version, entry: entry, progress: progress)
    }

    /// The engine an app bundle's manifest names (the bundle's own launcher.json pin), fetched
    /// beside the bundle rather than after it; ensureEngine waits on engineLock for it.
    static func prefetchEngineAsset(paths: LauncherPaths, version: String, entry: [String: Any]) {
        let ready = DispatchSemaphore(value: 0)
        Thread.detachNewThread {
            engineLock.lock()
            ready.signal()
            defer { engineLock.unlock() }
            do {
                _ = try installEngineAsset(paths: paths, version: version, entry: entry, progress: { _ in })
            } catch {
                log("install: early stella-engine download failed (\(error)); trying again")
            }
        }
        ready.wait()
    }

    /// Downloads one stella-engine build (an asset of launcher.json's "stellaEngine") unless it
    /// is already there.
    private static func installEngineAsset(
        paths: LauncherPaths, version: String, entry: [String: Any], progress: (String) -> Void
    ) throws -> (bin: URL, version: String) {
        let fm = FileManager.default
        guard let rawURL = entry["url"] as? String, let url = URL(string: rawURL),
              let sha = entry["sha256"] as? String
        else { throw LauncherError("This version of Stella has no Rune engine for \(Pins.platformKey).") }
        let dir = paths.runtimes.appendingPathComponent("stella-engine-\(version)")
        let appName = entry["app"] as? String
        let bin = appName.map { dir.appendingPathComponent("\($0)/Contents/MacOS/stella-engine") }
            ?? dir.appendingPathComponent("stella-engine")
        if fm.isExecutableFile(atPath: bin.path) { return (bin, version) }
        progress("Getting things ready…")
        log("install: downloading stella-engine \(version) from \(rawURL)")
        try fm.createDirectory(at: dir, withIntermediateDirectories: true)
        let downloaded = paths.runtimes.appendingPathComponent(".stella-engine-\(version).download")
        try Net.download(url, to: downloaded, sha256: sha)
        defer { try? fm.removeItem(at: downloaded) }
        if let appName {
            let staging = paths.runtimes.appendingPathComponent(".stella-engine-\(version).partial")
            try? fm.removeItem(at: staging)
            defer { try? fm.removeItem(at: staging) }
            let unzip = try Shell.run("/usr/bin/ditto", ["-x", "-k", downloaded.path, staging.path], env: [:])
            guard unzip.code == 0 else { throw LauncherError("Could not unpack stella-engine: \(unzip.stderr)") }
            let app = staging.appendingPathComponent(appName)
            if !ElectronIdentity.unsignedOptIn {
                let verify = try Shell.run(
                    "/usr/bin/codesign", ["--verify", "--deep", "--strict", "-R=\(ElectronIdentity.requirement)", app.path], env: [:])
                guard verify.code == 0 else { throw LauncherError("stella-engine's signature check failed: \(verify.stderr)") }
            }
            let target = dir.appendingPathComponent(appName)
            try? fm.removeItem(at: target)
            try fm.moveItem(at: app, to: target)
            log("install: stella-engine \(version) ready")
            return (bin, version)
        }
        try? fm.removeItem(at: bin)
        if let member = entry["member"] as? String {
            let staging = paths.runtimes.appendingPathComponent(".stella-engine-\(version).partial")
            try? fm.removeItem(at: staging)
            let unzip = try Shell.run("/usr/bin/ditto", ["-x", "-k", downloaded.path, staging.path], env: [:])
            guard unzip.code == 0 else { throw LauncherError("Could not unpack stella-engine: \(unzip.stderr)") }
            try fm.moveItem(at: staging.appendingPathComponent(member), to: bin)
            try? fm.removeItem(at: staging)
        } else {
            try fm.moveItem(at: downloaded, to: bin)
        }
        try fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: bin.path)
        log("install: stella-engine \(version) ready")
        return (bin, version)
    }

    private static func requestedBun(paths: LauncherPaths) -> (String, Pins.Asset)? {
        let manifest = paths.app.appendingPathComponent("packages/desktop/launcher.json")
        guard let data = try? Data(contentsOf: manifest),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let bun = json["bun"] as? [String: Any],
              let version = bun["version"] as? String,
              let assets = bun["assets"] as? [String: Any],
              let entry = assets[Pins.platformKey] as? [String: Any],
              let url = entry["url"] as? String,
              let sha = entry["sha256"] as? String
        else { return nil }
        return (version, Pins.Asset(url: url, sha256: sha, member: entry["member"] as? String))
    }

    enum Source {
        case upstream(backend: String)
        case explicit(String, ref: String?)
    }

    /// Stage 1 of a first install: the app bundle (scripts/build-app-bundle.mjs: the published
    /// tree plus the Rune host and UI boot bundles, the runtime bytecode and React, without
    /// node_modules or .git) unpacked into the app folder, with the engine its manifest names
    /// downloading beside it. `manifest` is a URL or a path; returns the bundle's commit.
    ///
    ///   { format, commit, platforms: { <platform>: { file, url?, sha256, bytes, files, backend,
    ///     engine?: { version, url, sha256, member?, app? } } } }
    static func installBundle(
        paths: LauncherPaths, manifest: String, prefetchEngine: Bool, progress: (String) -> Void
    ) throws -> String {
        let fm = FileManager.default
        let started = Date()
        let data: Data
        if isURL(manifest) {
            guard let url = URL(string: manifest) else { throw LauncherError("Bad app bundle manifest URL \(manifest).") }
            let (body, response) = try Net.fetch(URLRequest(url: url))
            guard response.statusCode == 200 else {
                throw LauncherError("The app bundle manifest returned HTTP \(response.statusCode).")
            }
            data = body
        } else {
            data = try Data(contentsOf: URL(fileURLWithPath: manifest))
        }
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw LauncherError("Could not read the app bundle manifest \(manifest).")
        }
        let platform = (json["platforms"] as? [String: Any])?[Pins.platformKey] as? [String: Any]
        guard let commit = json["commit"] as? String,
              let file = (platform?["url"] as? String) ?? (platform?["file"] as? String),
              let sha = platform?["sha256"] as? String
        else { throw LauncherError("The app bundle manifest has no \(Pins.platformKey) bundle.") }
        let ref = resolve(manifest: manifest, ref: file)
        if prefetchEngine, let engine = platform?["engine"] as? [String: Any],
           let version = engine["version"] as? String, engine["url"] is String, engine["sha256"] is String {
            prefetchEngineAsset(paths: paths, version: version, entry: engine)
        }
        progress("Downloading Stella…")
        log("install: app bundle \(commit.prefix(12)) from \(ref)")
        try fm.createDirectory(at: paths.runtimes, withIntermediateDirectories: true)
        let archive = paths.runtimes.appendingPathComponent("app-bundle.tar.gz")
        defer { try? fm.removeItem(at: archive) }
        if isURL(ref) {
            guard let url = URL(string: ref) else { throw LauncherError("Bad app bundle URL \(ref).") }
            try Net.download(url, to: archive, sha256: sha)
        } else {
            try? fm.removeItem(at: archive)
            try fm.copyItem(at: URL(fileURLWithPath: ref), to: archive)
            let actual = try sha256File(archive)
            guard actual == sha.lowercased() else {
                throw LauncherError("Checksum mismatch for \(ref): expected \(sha), got \(actual).")
            }
        }
        let staging = paths.appStaging
        try? fm.removeItem(at: staging)
        do {
            try fm.createDirectory(at: staging, withIntermediateDirectories: true)
            let untar = try Shell.run("/usr/bin/tar", ["-xzf", archive.path, "-C", staging.path], env: [:])
            guard untar.code == 0 else { throw LauncherError("Could not unpack the app bundle: \(untar.stderr)") }
            try fm.createDirectory(at: paths.app.deletingLastPathComponent(), withIntermediateDirectories: true)
            try fm.moveItem(at: staging, to: paths.app)
        } catch {
            try? fm.removeItem(at: staging)
            throw error
        }
        log("install: app bundle in place in \(String(format: "%.1f", Date().timeIntervalSince(started)))s")
        return commit
    }

    static func isURL(_ value: String) -> Bool { value.hasPrefix("https://") || value.hasPrefix("http://") }

    /// A manifest entry's file is relative to the manifest unless it is a URL.
    private static func resolve(manifest: String, ref: String) -> String {
        if isURL(ref) || ref.hasPrefix("/") { return ref }
        guard let slash = manifest.lastIndex(of: "/") else { return ref }
        return "\(manifest[..<slash])/\(ref)"
    }

    static func cloneSource(paths: LauncherPaths, git: GitTool, source: Source, progress: (String) -> Void) throws {
        progress("Downloading Stella…")
        let staging = paths.appStaging
        try? FileManager.default.removeItem(at: staging)
        try FileManager.default.createDirectory(at: staging.deletingLastPathComponent(), withIntermediateDirectories: true)
        var args = ["clone", "--origin", Pins.upstreamRemoteName]
        var env: [String: String] = [:]
        let remote: String
        switch source {
        case let .explicit(location, ref):
            remote = location
            if let ref { args += ["--branch", ref] }
        case let .upstream(backend):
            let access = try bootstrapAccess(backend: backend)
            remote = access.remote
            args += ["--branch", Pins.upstreamBranch]
            env = [
                "GIT_CONFIG_COUNT": "2",
                "GIT_CONFIG_KEY_0": "http.extraHeader",
                "GIT_CONFIG_VALUE_0": "Authorization: Bearer \(access.token)",
                "GIT_CONFIG_KEY_1": "protocol.version",
                "GIT_CONFIG_VALUE_1": "1",
            ]
        }
        log("install: cloning \(remote)")
        try git.run(args + [remote, staging.path], cwd: paths.root, extraEnv: env)
        try FileManager.default.moveItem(at: staging, to: paths.app)
        log("install: source at \(try git.run(["rev-parse", "HEAD"], cwd: paths.app))")
    }

    /// The upstream's remote and token, and the app bundle offered to a first install ("bundle").
    static func bootstrapAccess(backend: String) throws -> (remote: String, token: String, bundleManifest: String?) {
        let trimmed = backend.hasSuffix("/") ? String(backend.dropLast()) : backend
        guard let url = URL(string: "\(trimmed)/api/app-source/bootstrap") else {
            throw LauncherError("Invalid backend URL \(backend).")
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data("{}".utf8)
        log("install: POST \(url.absoluteString)")
        let (data, response) = try Net.fetch(request)
        guard response.statusCode == 200 else {
            throw LauncherError("The app source bootstrap returned HTTP \(response.statusCode).")
        }
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw LauncherError("The app source bootstrap returned an unexpected body.")
        }
        let manifest = ((json["bundle"] as? [String: Any])?["manifest"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        let body = (json["upstream"] as? [String: Any]) ?? json
        guard let remote = body["remote"] as? String, let token = body["token"] as? String else {
            throw LauncherError("The app source bootstrap response has no remote and token.")
        }
        return (remote, token, manifest)
    }
}
