import SwiftUI
import WebKit
import AppKit
import Network

// WebKit is the small platform bridge for the shared desktop/management controls.
struct LocalWebView: NSViewRepresentable {
    let url: URL
    func makeCoordinator() -> Coordinator { Coordinator(origin: url) }
    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.userContentController.add(context.coordinator, name: "clockPermission")
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        view.allowsBackForwardNavigationGestures = false
        view.load(URLRequest(url: url)); context.coordinator.loadedURL = url
        return view
    }
    func updateNSView(_ view: WKWebView, context: Context) {
        guard context.coordinator.loadedURL != url else { return }
        context.coordinator.loadedURL = url; context.coordinator.origin = url
        view.load(URLRequest(url: url))
    }
    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        var origin: URL
        var loadedURL: URL?
        private var clockConnection: NWConnection?
        init(origin: URL) { self.origin = origin }
        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "clockPermission", let host = message.body as? String,
                  host.hasPrefix("192.168.") || host.hasPrefix("10.") || host.hasPrefix("172.") else { return }
            let parts = host.split(separator: ".")
            guard parts.count == 4, parts.allSatisfy({ Int($0).map { (0...255).contains($0) } ?? false }) else { return }
            clockConnection?.cancel()
            let connection = NWConnection(host: NWEndpoint.Host(host), port: 80, using: .tcp)
            clockConnection = connection
            connection.stateUpdateHandler = { state in
                if case .ready = state { connection.cancel() }
            }
            connection.start(queue: .main)
            DispatchQueue.main.asyncAfter(deadline: .now() + 8) { connection.cancel() }
        }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            let arguments = ProcessInfo.processInfo.arguments
            guard let index = arguments.firstIndex(of: "--snapshot"), arguments.count > index + 1 else { return }
            let path = arguments[index + 1]
            DispatchQueue.main.asyncAfter(deadline: .now() + 10) { [weak webView] in
                webView?.takeSnapshot(with: nil) { image, _ in
                    guard let bytes = image?.tiffRepresentation,
                          let bitmap = NSBitmapImageRep(data: bytes),
                          let png = bitmap.representation(using: .png, properties: [:]) else { return }
                    try? png.write(to: URL(fileURLWithPath: path), options: .atomic)
                }
            }
        }
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let target = action.request.url else { decisionHandler(.cancel); return }
            if target.host == origin.host && target.port == origin.port && target.scheme == "http" {
                decisionHandler(.allow)
            } else {
                if action.navigationType == .linkActivated, ["https", "http"].contains(target.scheme ?? "") { NSWorkspace.shared.open(target) }
                decisionHandler(.cancel)
            }
        }
    }
}
