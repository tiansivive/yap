import XCTest
import SwiftTreeSitter
import TreeSitterYap

final class TreeSitterYapTests: XCTestCase {
    func testCanLoadGrammar() throws {
        let parser = Parser()
        let language = Language(language: tree_sitter_yap())
        XCTAssertNoThrow(try parser.setLanguage(language),
                         "Error loading Yap grammar")
    }
}
