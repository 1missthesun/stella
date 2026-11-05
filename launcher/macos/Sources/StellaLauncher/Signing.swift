import CryptoKit
import Foundation
import Security

/// Signs and verifies the app tree (step 5b).
///
/// The signature is ECDSA P-256 / SHA-256 over `stella-tree-v1\n<HEAD^{tree}>\n`,
/// DER-encoded, stored base64 as a git note under `refs/notes/stella-signed`
/// on the commit. Notes are local; each device signs its own applies.
///
/// The private key lives in the login keychain as an item this launcher
/// creates (the keychain's default ACL trusts only the creating app, so other
/// programs get a prompt). `STELLA_LAUNCHER_KEY_FILE` points at a 0600 PEM
/// instead, for testing on machines whose keychain is unavailable.
final class TreeSigner {
    static let notesRef = "stella-signed"
    static let keychainService = "sh.stella.launcher.tree-signing"
    static let keychainAccount = "p256"

    private let key: P256.Signing.PrivateKey

    init(paths: LauncherPaths) throws {
        if let file = ProcessInfo.processInfo.environment["STELLA_LAUNCHER_KEY_FILE"]?
            .trimmingCharacters(in: .whitespacesAndNewlines), !file.isEmpty {
            key = try TreeSigner.loadOrCreateFileKey(URL(fileURLWithPath: (file as NSString).expandingTildeInPath))
        } else {
            key = try TreeSigner.loadOrCreateKeychainKey()
        }
        let pem = key.publicKey.pemRepresentation + "\n"
        if (try? String(contentsOf: paths.signingPub, encoding: .utf8)) != pem {
            try pem.write(to: paths.signingPub, atomically: true, encoding: .utf8)
        }
    }

    var publicKeySPKIBase64: String { key.publicKey.derRepresentation.base64EncodedString() }

    static func message(tree: String) -> Data { Data("stella-tree-v1\n\(tree)\n".utf8) }

    func signature(tree: String) throws -> String {
        try key.signature(for: TreeSigner.message(tree: tree)).derRepresentation.base64EncodedString()
    }

    func verify(tree: String, note: String) -> Bool {
        guard let der = Data(base64Encoded: note.trimmingCharacters(in: .whitespacesAndNewlines)),
              let signature = try? P256.Signing.ECDSASignature(derRepresentation: der)
        else { return false }
        return key.publicKey.isValidSignature(signature, for: TreeSigner.message(tree: tree))
    }

    @discardableResult
    func signHead(git: GitTool, app: URL, expected: String?) throws -> String {
        let head = try git.run(["rev-parse", "HEAD"], cwd: app)
        if let expected, !expected.isEmpty, expected != head {
            throw LauncherError("HEAD is \(head.prefix(12)), not \(expected.prefix(12)).")
        }
        let dirty = try changedFiles(git: git, app: app)
        guard dirty.isEmpty else {
            throw LauncherError("The checkout has uncommitted changes: \(dirty.prefix(5).joined(separator: ", ")).")
        }
        let tree = try git.run(["rev-parse", "HEAD^{tree}"], cwd: app)
        let note = try signature(tree: tree)
        try git.run(["notes", "--ref", TreeSigner.notesRef, "add", "-f", "-m", note, head],
                    cwd: app, extraEnv: GitTool.identityEnv)
        log("signing: signed \(head.prefix(12)) tree \(tree.prefix(12))")
        return head
    }

    /// What changed outside Stella's updates: the working tree as git would
    /// commit it, compared with the newest commit this launcher signed.
    func outsideChanges(git: GitTool, app: URL) throws -> OutsideChanges? {
        let head = try git.run(["rev-parse", "HEAD"], cwd: app)
        let headTree = try git.run(["rev-parse", "HEAD^{tree}"], cwd: app)
        let clean = try changedFiles(git: git, app: app).isEmpty
        let headSigned = isSigned(git: git, app: app, commit: head, tree: headTree)
        if clean && headSigned { return nil }
        let tree = clean ? headTree : try workingTree(git: git, app: app)
        let base = headSigned ? head : try newestSignedAncestor(git: git, app: app, head: head)
        var files: [OutsideChanges.File] = []
        if let base {
            let diff = try git.raw(["diff-tree", "-r", "--no-renames", "--name-status", "-z", base, tree], cwd: app)
            guard diff.code == 0 else { throw LauncherError("git diff-tree failed: \(diff.stderr)") }
            let fields = diff.stdout.split(separator: "\0", omittingEmptySubsequences: true).map(String.init)
            var index = 0
            while index + 1 < fields.count {
                files.append(OutsideChanges.File(status: fields[index], path: fields[index + 1]))
                index += 2
            }
        }
        return OutsideChanges(head: head, tree: tree, files: files)
    }

    /// Makes exactly `seen` the trusted state: commits the working tree as it
    /// was shown, then signs it. Returns false, changing nothing, when the
    /// checkout no longer matches what the user saw.
    func acceptOutsideChanges(_ seen: OutsideChanges, git: GitTool, app: URL) throws -> Bool {
        guard let now = try outsideChanges(git: git, app: app) else { return true }
        guard now.head == seen.head, now.tree == seen.tree else {
            log("outside: the checkout changed while the notice was up; asking again")
            return false
        }
        var head = seen.head
        let headTree = try git.run(["rev-parse", "HEAD^{tree}"], cwd: app)
        if seen.tree != headTree {
            let commit = try git.run(
                ["commit-tree", seen.tree, "-p", head, "-m", "Changes made outside Stella"],
                cwd: app, extraEnv: GitTool.identityEnv)
            try git.run(["update-ref", "-m", "stella: accept changes made outside Stella", "HEAD", commit, head], cwd: app)
            try git.run(["reset", "-q"], cwd: app)
            head = commit
        }
        try signHead(git: git, app: app, expected: head)
        log("outside: accepted \(seen.files.count) file(s) as \(head.prefix(12))")
        return true
    }

    private func isSigned(git: GitTool, app: URL, commit: String, tree: String) -> Bool {
        guard let note = try? git.raw(["notes", "--ref", TreeSigner.notesRef, "show", commit], cwd: app),
              note.code == 0
        else { return false }
        return verify(tree: tree, note: note.stdout)
    }

    private func newestSignedAncestor(git: GitTool, app: URL, head: String) throws -> String? {
        let listed = try git.raw(["notes", "--ref", TreeSigner.notesRef, "list"], cwd: app)
        let annotated = Set(listed.stdout.split(separator: "\n").compactMap { $0.split(separator: " ").last.map(String.init) })
        guard !annotated.isEmpty else { return nil }
        let history = try git.run(["rev-list", "--max-count=500", head], cwd: app).split(separator: "\n").map(String.init)
        for commit in history where annotated.contains(commit) {
            let tree = try git.run(["rev-parse", "\(commit)^{tree}"], cwd: app)
            if isSigned(git: git, app: app, commit: commit, tree: tree) { return commit }
        }
        return nil
    }

    /// The tree `git add -A` would produce, built in a scratch copy of the
    /// index so the checkout's own index is untouched.
    private func workingTree(git: GitTool, app: URL) throws -> String {
        let fm = FileManager.default
        let index = URL(fileURLWithPath: try git.run(["rev-parse", "--git-path", "index"], cwd: app), relativeTo: app)
            .standardizedFileURL
        let scratch = index.deletingLastPathComponent().appendingPathComponent("stella-outside-\(getpid()).index")
        try? fm.removeItem(at: scratch)
        defer { try? fm.removeItem(at: scratch) }
        if fm.fileExists(atPath: index.path) { try fm.copyItem(at: index, to: scratch) }
        let env = ["GIT_INDEX_FILE": scratch.path]
        try git.run(["add", "-A"], cwd: app, extraEnv: env)
        return try git.run(["write-tree"], cwd: app, extraEnv: env)
    }

    func changedFiles(git: GitTool, app: URL) throws -> [String] {
        try git.run(["status", "--porcelain=v1", "--untracked-files=all"], cwd: app)
            .split(separator: "\n").map { String($0) }.filter { !$0.isEmpty }
    }

    private static func loadOrCreateFileKey(_ url: URL) throws -> P256.Signing.PrivateKey {
        if FileManager.default.fileExists(atPath: url.path) {
            let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
            if let mode = attributes[.posixPermissions] as? NSNumber, mode.intValue & 0o077 != 0 {
                throw LauncherError("\(url.path) must not be readable by other users (chmod 600).")
            }
            let pem = try String(contentsOf: url, encoding: .utf8)
            return try P256.Signing.PrivateKey(pemRepresentation: pem)
        }
        let key = P256.Signing.PrivateKey()
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        guard FileManager.default.createFile(
            atPath: url.path, contents: Data((key.pemRepresentation + "\n").utf8),
            attributes: [.posixPermissions: 0o600])
        else { throw LauncherError("Could not write \(url.path).") }
        log("signing: generated a key file at \(url.path)")
        return key
    }

    private static func loadOrCreateKeychainKey() throws -> P256.Signing.PrivateKey {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecSuccess, let data = item as? Data {
            return try P256.Signing.PrivateKey(rawRepresentation: data)
        }
        guard status == errSecItemNotFound else {
            throw LauncherError("Could not read the signing key from the keychain (\(status)).")
        }
        let key = P256.Signing.PrivateKey()
        let add: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
            kSecAttrLabel as String: "Stella app signing key",
            kSecValueData as String: key.rawRepresentation,
        ]
        let added = SecItemAdd(add as CFDictionary, nil)
        guard added == errSecSuccess else {
            throw LauncherError("Could not store the signing key in the keychain (\(added)).")
        }
        log("signing: generated a keychain key")
        return key
    }
}

struct OutsideChanges: Equatable {
    struct File: Equatable {
        let status: String
        let path: String

        var kind: String {
            switch status.prefix(1) {
            case "A": return "added"
            case "D": return "removed"
            default: return "changed"
            }
        }
    }

    let head: String
    let tree: String
    let files: [File]
}
