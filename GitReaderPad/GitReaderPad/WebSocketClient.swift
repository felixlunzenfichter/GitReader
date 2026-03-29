import Foundation
import Observation
import AVFoundation

@Observable
@MainActor
final class WebSocketClient {
    var lines: [String] = []
    var isConnected: Bool = false

    private let serverURL: URL
    private var audioPlayer: AVAudioPlayer?

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
            task.maximumMessageSize = 16 * 1024 * 1024
            task.resume()
            await MainActor.run {
                self.isConnected = true
                log("connected to \(self.serverURL)")
            }

            do {
                try await task.send(.string("ready"))
                while true {
                    let message = try await task.receive()
                    switch message {
                    case .string(let text):
                        let parsed = text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
                        await MainActor.run {
                            self.lines = parsed
                            log("diff received (\(text.count) chars, \(parsed.count) lines)")
                        }
                    case .data(let audioData):
                        await MainActor.run {
                            self.playAudio(audioData)
                        }
                    @unknown default:
                        break
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

    private func playAudio(_ data: Data) {
        log("[TTS] received audio: \(data.count) bytes")
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .spokenAudio)
            try session.setActive(true)
            audioPlayer = try AVAudioPlayer(data: data)
            audioPlayer?.play()
            log("[TTS] playback started")
        } catch {
            logError("[TTS] playback failed: \(error)")
        }
    }
}
