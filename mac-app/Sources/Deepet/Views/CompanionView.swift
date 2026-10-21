import SwiftUI

struct CompanionView: View {
    @ObservedObject var backend: BackendService
    var settings = false
    var body: some View {
        Group {
            if let url = backend.url {
                LocalWebView(url: settings ? url.appending(queryItems: [URLQueryItem(name: "page", value: "settings")]) : url)
            } else {
                VStack(spacing: 18) {
                    Image(systemName: "bubble.left.and.bubble.right").font(.system(size: 42)).foregroundStyle(.secondary)
                    Text("Deepet").font(.title)
                    if let error = backend.error {
                        Text(error).font(.body).foregroundStyle(.secondary).multilineTextAlignment(.center).frame(maxWidth: 520)
                        Button("重新启动") { backend.stop(); backend.start() }.buttonStyle(.borderedProminent)
                    } else { ProgressView("正在准备桌面陪伴…") }
                }.frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }
}
