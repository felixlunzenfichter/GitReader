import SwiftUI

@main
struct GitReaderPadApp: App {
    init() {
        log("launched")
    }

    var body: some Scene {
        WindowGroup {
            DiffView()
        }
    }
}
