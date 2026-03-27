import SwiftUI
import UIKit

struct DiffView: View {
    @State private var client = WebSocketClient()

    var body: some View {
        DiffTextView(lines: client.lines)
            .ignoresSafeArea()
            .overlay(alignment: .topTrailing) {
                Circle()
                    .fill(client.isConnected ? .green : .red)
                    .frame(width: 10, height: 10)
                    .padding(16)
            }
            .preferredColorScheme(.dark)
            .task { client.start() }
    }
}

// MARK: - UIKit text view (handles 200k+ lines without issue)

private struct DiffTextView: UIViewRepresentable {
    let lines: [String]

    func makeUIView(context: Context) -> UITextView {
        let tv = UITextView()
        tv.isEditable = false
        tv.backgroundColor = .black
        tv.indicatorStyle = .white
        tv.textContainerInset = UIEdgeInsets(top: 12, left: 8, bottom: 12, right: 8)
        tv.font = UIFont.monospacedSystemFont(ofSize: 13, weight: .regular)
        return tv
    }

    func updateUIView(_ tv: UITextView, context: Context) {
        let snapshot = lines
        if snapshot.isEmpty { return }

        // Build attributed string off main thread, apply on main
        DispatchQueue.global(qos: .userInitiated).async {
            let result = NSMutableAttributedString()
            let mono = UIFont.monospacedSystemFont(ofSize: 13, weight: .regular)
            let nl = NSAttributedString(string: "\n")

            for (i, line) in snapshot.enumerated() {
                let color = uiColorForLine(line)
                let str = NSAttributedString(
                    string: "\u{2502} \(line)",
                    attributes: [.foregroundColor: color, .font: mono]
                )
                result.append(str)
                if i < snapshot.count - 1 {
                    result.append(nl)
                }
            }

            DispatchQueue.main.async {
                let offset = tv.contentOffset
                tv.attributedText = result
                tv.contentOffset = offset
            }
        }
    }

    // 1:1 match with SpiralLayout.ts colorForLine()
    private func uiColorForLine(_ line: String) -> UIColor {
        if line.hasPrefix("#")  { return UIColor(red: 0.7, green: 0.4, blue: 0.9, alpha: 1) } // purple
        if line.hasPrefix("@@") { return UIColor(red: 0.3, green: 0.8, blue: 0.9, alpha: 1) } // cyan
        if line.hasPrefix("+")  { return UIColor(red: 0.3, green: 0.9, blue: 0.3, alpha: 1) } // green
        if line.hasPrefix("-")  { return UIColor(red: 0.9, green: 0.3, blue: 0.3, alpha: 1) } // red
        return UIColor(red: 0.85, green: 0.85, blue: 0.85, alpha: 1)                           // gray
    }
}
