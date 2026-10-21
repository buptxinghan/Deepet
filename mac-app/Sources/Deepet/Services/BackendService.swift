import Foundation
import Combine

@MainActor
final class BackendService: ObservableObject {
    @Published var url: URL?
    @Published var error: String?
    private var process: Process?
    private var output: Pipe?
    private var errors: Pipe?
    private var buffer = Data()
    private var stopping = false

    func start() {
        guard process == nil, let resources = Bundle.main.resourceURL else { return }
        let runtime = resources.appendingPathComponent("runtime")
        let node = runtime.appendingPathComponent("node")
        let script = runtime.appendingPathComponent("companion/server.cjs")
        guard FileManager.default.isExecutableFile(atPath: node.path) else {
            error = "配套程序资源不完整，请重新构建应用。"; return
        }
        stopping = false; error = nil; buffer = Data()
        let child = Process(), out = Pipe(), err = Pipe()
        child.executableURL = node; child.arguments = [script.path]
        var environment = ProcessInfo.processInfo.environment
        environment["DESK_COMPANION_PORT"] = "0"
        child.environment = environment; child.standardOutput = out; child.standardError = err
        child.currentDirectoryURL = runtime
        out.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let bytes = handle.availableData
            guard !bytes.isEmpty else { return }
            Task { @MainActor in self?.received(bytes) }
        }
        err.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let bytes = handle.availableData
            guard !bytes.isEmpty else { return }
            Task { @MainActor in
                if self?.url == nil { self?.error = String(data: bytes, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) }
            }
        }
        child.terminationHandler = { [weak self] child in
            Task { @MainActor in
                guard let self, !self.stopping else { return }
                self.url = nil; self.process = nil
                self.error = "配套程序已停止（\(child.terminationStatus)），可以重新启动。"
            }
        }
        do { try child.run(); process = child; output = out; errors = err }
        catch { self.error = "启动失败：\(error.localizedDescription)" }
    }
    private func received(_ bytes: Data) {
        buffer.append(bytes)
        while let end = buffer.firstIndex(of: 10) {
            let line = String(data: buffer[..<end], encoding: .utf8) ?? ""
            buffer.removeSubrange(...end)
            if line.hasPrefix("READY "), let data = line.dropFirst(6).data(using: .utf8),
               let object = try? JSONSerialization.jsonObject(with: data) as? [String: String],
               let address = object["url"], let endpoint = URL(string: address), endpoint.host == "127.0.0.1" {
                error = nil; url = endpoint
            }
        }
    }
    func stop() {
        stopping = true
        output?.fileHandleForReading.readabilityHandler = nil
        errors?.fileHandleForReading.readabilityHandler = nil
        if let process, process.isRunning { process.terminate() }
        process = nil; output = nil; errors = nil; url = nil
    }
}
