import SwiftUI

struct DiffView: View {
    @State private var client = WebSocketClient()

    var body: some View {
        ScrollView([.horizontal, .vertical]) {
            Text(attributedDiff)
                .font(.system(size: 13, design: .monospaced))
                .textSelection(.enabled)
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .defaultScrollAnchor(.topLeading)
        .background(.black)
        .overlay(alignment: .topTrailing) {
            Circle()
                .fill(client.isConnected ? .green : .red)
                .frame(width: 10, height: 10)
                .padding(16)
        }
        .ignoresSafeArea()
        .preferredColorScheme(.dark)
        .task { client.start() }
    }

    // 1:1 match with SpiralLayout.ts colorForLine()
    private var attributedDiff: AttributedString {
        var result = AttributedString()
        let rawLines = client.diffText.split(
            separator: "\n", omittingEmptySubsequences: false
        )
        for (i, line) in rawLines.enumerated() {
            let s = String(line)
            var part = AttributedString("\u{2502} \(s)")
            part.foregroundColor = colorForLine(s)
            result.append(part)
            if i < rawLines.count - 1 {
                result.append(AttributedString("\n"))
            }
        }
        return result
    }

    private func colorForLine(_ line: String) -> Color {
        if line.hasPrefix("#")  { return Color(red: 0.7, green: 0.4, blue: 0.9) } // purple - metadata
        if line.hasPrefix("@@") { return Color(red: 0.3, green: 0.8, blue: 0.9) } // cyan   - hunk header
        if line.hasPrefix("+")  { return Color(red: 0.3, green: 0.9, blue: 0.3) } // green  - addition
        if line.hasPrefix("-")  { return Color(red: 0.9, green: 0.3, blue: 0.3) } // red    - deletion
        return Color(red: 0.85, green: 0.85, blue: 0.85)                           // gray   - context
    }
}
