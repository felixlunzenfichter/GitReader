import Foundation

final class WSConnection: NSObject, URLSessionWebSocketDelegate, @unchecked Sendable {
    private var task: URLSessionWebSocketTask?
    private var session: URLSession?
    private var openContinuation: CheckedContinuation<Void, Error>?

    struct WSError: Error, CustomStringConvertible {
        let description: String
    }

    func connect(to url: URL, timeout: TimeInterval = 5) async throws {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = timeout
        let session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
        self.session = session

        let task = session.webSocketTask(with: url)
        self.task = task
        task.resume()

        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            self.openContinuation = cont
        }
    }

    func send(_ string: String) async throws {
        guard let task else { throw WSError(description: "not connected") }
        try await task.send(.string(string))
    }

    func receive() async throws -> [String: Any] {
        guard let task else { throw WSError(description: "not connected") }
        let msg = try await task.receive()
        switch msg {
        case .string(let s):
            return try JSONSerialization.jsonObject(with: Data(s.utf8)) as? [String: Any] ?? [:]
        case .data(let d):
            return try JSONSerialization.jsonObject(with: d) as? [String: Any] ?? [:]
        @unknown default:
            throw WSError(description: "unknown frame")
        }
    }

    func close() {
        task?.cancel(with: .normalClosure, reason: nil)
        session?.invalidateAndCancel()
        task = nil
        session = nil
    }

    // MARK: - URLSessionWebSocketDelegate

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol proto: String?) {
        openContinuation?.resume()
        openContinuation = nil
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith code: URLSessionWebSocketTask.CloseCode, reason: Data?) {}

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error {
            openContinuation?.resume(throwing: error)
            openContinuation = nil
        }
    }
}
