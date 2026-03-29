import Foundation
import Observation
import AVFoundation

@Observable
@MainActor
final class WebSocketClient: NSObject, AVAudioPlayerDelegate {
    var lines: [String] = []
    var isConnected: Bool = false

    private let serverURL: URL
    private var audioPlayer: AVAudioPlayer?
    private var pendingAudio: [Data] = []
    private var isPlayingAudio: Bool = false
    private var diffLines: [String] = []
    private var liveEventLines: [String] = []

    init(serverURL: URL = URL(string: "ws://felixs-macbook-pro.tailcfdca5.ts.net:9876")!) {
        self.serverURL = serverURL
        super.init()
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
                        await MainActor.run {
                            self.handleTextMessage(text)
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

    private func handleTextMessage(_ text: String) {
        if let data = text.data(using: .utf8),
           let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let type = payload["type"] as? String {
            switch type {
            case "diff":
                let diff = payload["diff"] as? String ?? ""
                applyDiff(diff)
                return
            case "task_event":
                if let entry = payload["entry"] as? [String: Any] {
                    applyTaskEvent(entry)
                    return
                }
            default:
                break
            }
        }

        applyDiff(text)
    }

    private func applyDiff(_ text: String) {
        diffLines = text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        rebuildVisibleLines()
        log("diff received (\(text.count) chars, \(diffLines.count) lines)")
    }

    private func applyTaskEvent(_ entry: [String: Any]) {
        let event = (entry["event"] as? String) ?? "task_event"
        let task = (entry["task"] as? String) ?? "-"
        let status = (entry["status"] as? String) ?? "-"
        let source = (entry["source"] as? String) ?? "-"
        let sessionKey = (entry["session_key"] as? String) ?? ((entry["session"] as? String) ?? "-")
        let line = "# LIVE [\(event)] [\(status)] [\(source)] [\(sessionKey)] :: \(task)"

        liveEventLines.insert(line, at: 0)
        liveEventLines = Array(liveEventLines.prefix(8))
        rebuildVisibleLines()
        log("[LIVE] native task event received: \(event) :: \(task) :: \(sessionKey)")
    }

    private func rebuildVisibleLines() {
        if liveEventLines.isEmpty {
            lines = diffLines
            return
        }

        lines = liveEventLines + ["#", "# Live Native Events", "#"] + diffLines
    }

    private func playAudio(_ data: Data) {
        pendingAudio.append(data)
        log("[TTS] queued audio: \(data.count) bytes (pending=\(pendingAudio.count), playing=\(isPlayingAudio))")
        drainAudioQueueIfNeeded()
    }

    private func drainAudioQueueIfNeeded() {
        guard !isPlayingAudio, !pendingAudio.isEmpty else { return }

        let data = pendingAudio.removeFirst()
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .spokenAudio)
            try session.setActive(true)

            let player = try AVAudioPlayer(data: data)
            player.delegate = self
            audioPlayer = player
            isPlayingAudio = true
            player.play()
            log("[TTS] playback started (remaining=\(pendingAudio.count))")
        } catch {
            isPlayingAudio = false
            audioPlayer = nil
            logError("[TTS] playback failed: \(error)")
            drainAudioQueueIfNeeded()
        }
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor in
            self.isPlayingAudio = false
            self.audioPlayer = nil
            log("[TTS] playback finished success=\(flag) (remaining=\(self.pendingAudio.count))")
            self.drainAudioQueueIfNeeded()
        }
    }

    nonisolated func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        Task { @MainActor in
            self.isPlayingAudio = false
            self.audioPlayer = nil
            logError("[TTS] playback decode error: \(String(describing: error))")
            self.drainAudioQueueIfNeeded()
        }
    }
}
