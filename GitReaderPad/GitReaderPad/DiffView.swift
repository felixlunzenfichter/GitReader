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

// MARK: - UIKit text view (TextKit renders only visible glyphs)

private struct DiffTextView: UIViewRepresentable {
    let lines: [String]

    final class Coordinator { var generation = 0 }
    func makeCoordinator() -> Coordinator { Coordinator() }

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
        if lines.isEmpty { return }

        let coord = context.coordinator
        coord.generation += 1
        let gen = coord.generation
        let lines = self.lines

        DispatchQueue.global(qos: .userInitiated).async {
            let result = NSMutableAttributedString()
            let mono = UIFont.monospacedSystemFont(ofSize: 13, weight: .regular)
            let nl = NSAttributedString(string: "\n")

            for (i, line) in lines.enumerated() {
                let color = uiColorForLine(line, index: i, lines: lines)
                let str = NSAttributedString(
                    string: "\u{2502} \(line)",
                    attributes: [.foregroundColor: color, .font: mono]
                )
                result.append(str)
                if i < lines.count - 1 {
                    result.append(nl)
                }
            }

            DispatchQueue.main.async {
                guard coord.generation == gen else { return }
                let offset = tv.contentOffset
                tv.attributedText = result
                tv.contentOffset = offset
            }
        }
    }

    // 1:1 match with SpiralLayout.ts colorForLine()
    private func uiColorForLine(_ line: String, index: Int, lines: [String]) -> UIColor {
        // Timeline row coloring by task status
        if line.hasPrefix("# "), line.contains("[task_") {
            let lower = line.lowercased()
            if lower.contains("[running]") {
                return UIColor(red: 0.90, green: 0.78, blue: 0.00, alpha: 1) // yellow
            }
            if lower.contains("[inactive]") {
                return UIColor(red: 1.00, green: 0.55, blue: 0.00, alpha: 1) // orange
            }
            if lower.contains("[failed]") {
                return UIColor(red: 0.92, green: 0.30, blue: 0.30, alpha: 1) // red
            }
        }

        if line.hasPrefix("#")  { return UIColor(red: 0.7, green: 0.4, blue: 0.9, alpha: 1) } // purple
        if line.hasPrefix("@@") { return UIColor(red: 0.3, green: 0.8, blue: 0.9, alpha: 1) } // cyan
        if line.hasPrefix("+")  { return UIColor(red: 0.3, green: 0.9, blue: 0.3, alpha: 1) } // green
        if line.hasPrefix("-")  { return UIColor(red: 0.9, green: 0.3, blue: 0.3, alpha: 1) } // red
        return UIColor(red: 0.85, green: 0.85, blue: 0.85, alpha: 1)                           // gray
    }
}
