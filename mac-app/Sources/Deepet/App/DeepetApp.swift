import SwiftUI
import AppKit

@main
struct DeepetApp: App {
    @NSApplicationDelegateAdaptor(CompanionDelegate.self) var delegate
    @StateObject private var backend = BackendService()
    var body: some Scene {
        WindowGroup("Deepet", id: "main") {
            CompanionView(backend: backend)
                .frame(minWidth: 920, minHeight: 720)
                .preferredColorScheme(.dark)
                .task { delegate.backend = backend; backend.start() }
                .onReceive(NotificationCenter.default.publisher(for: NSApplication.willTerminateNotification)) { _ in backend.stop() }
        }
        .defaultSize(width: 1120, height: 850)
        .commands { CommandGroup(replacing: .newItem) {} }
        Settings { CompanionView(backend: backend, settings: true).frame(width: 950, height: 760).preferredColorScheme(.dark) }
        MenuBarExtra("Deepet", systemImage: "bubble.left.and.bubble.right") { CompanionMenu(backend: backend) }
    }
}

@MainActor
final class CompanionDelegate: NSObject, NSApplicationDelegate {
    var backend: BackendService?
    private var terminationSource: DispatchSourceSignal?
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
        signal(SIGTERM, SIG_IGN)
        let source = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
        source.setEventHandler { NSApp.terminate(nil) }
        source.resume(); terminationSource = source
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationWillTerminate(_ notification: Notification) { backend?.stop() }
}

struct CompanionMenu: View {
    @ObservedObject var backend: BackendService
    @Environment(\.openWindow) private var openWindow
    var body: some View {
        Text(backend.url == nil ? "正在启动" : "桌面陪伴运行中")
        Button("打开 Deepet") { openWindow(id: "main"); NSApp.activate(ignoringOtherApps: true) }
        if let url = backend.url { Button("在浏览器中打开") { NSWorkspace.shared.open(url) } }
        Divider()
        SettingsLink { Text("陪伴设置…") }
        Button("退出 Deepet") { backend.stop(); NSApp.terminate(nil) }.keyboardShortcut("q")
    }
}
