import Foundation
import Observation

@Observable
@MainActor
final class WebSocketClient {
    var diffText: String = ""
    var isConnected: Bool = false

    private var webSocketTask: URLSessionWebSocketTask?
    private let serverURL: URL

    init(serverURL: URL = URL(string: "ws://192.168.1.23:9876")!) {
        self.serverURL = serverURL
    }

    func start() {
        Task { await connectLoop() }
    }

    private nonisolated func connectLoop() async {
        while !Task.isCancelled {
            let session = URLSession(configuration: .default)
            let task = session.webSocketTask(with: serverURL)
            task.maximumMessageSize = 16 * 1024 * 1024 // 16 MB — diffs can be large
            await MainActor.run { self.webSocketTask = task }
            task.resume()
            await MainActor.run {
                self.isConnected = true
                log("connected to \(self.serverURL)")
            }

            do {
                try await task.send(.string("ready"))
                while true {
                    let message = try await task.receive()
                    if case .string(let text) = message {
                        await MainActor.run {
                            self.diffText = text
                            log("diff received (\(text.count) chars, \(text.filter { $0 == "\n" }.count) lines)")
                        }
                    }
                }
            } catch {
                await MainActor.run {
                    logError("connection lost: \(error)")
                    self.isConnected = false
                }
            }

            try? await Task.sleep(for: .seconds(2))
        }
    }
}
