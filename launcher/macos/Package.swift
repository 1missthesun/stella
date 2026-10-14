// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "StellaLauncher",
    platforms: [.macOS(.v12)],
    targets: [
        .executableTarget(
            name: "StellaLauncher",
            path: "Sources/StellaLauncher",
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("CryptoKit"),
                .linkedFramework("Security"),
                .linkedFramework("WebKit"),
            ]
        ),
    ]
)
