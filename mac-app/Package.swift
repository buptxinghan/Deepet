// swift-tools-version: 5.10
import PackageDescription
let package = Package(name: "Deepet", platforms: [.macOS(.v14)],
    products: [.executable(name: "Deepet", targets: ["Deepet"])],
    targets: [.executableTarget(name: "Deepet", path: "Sources/Deepet")])
