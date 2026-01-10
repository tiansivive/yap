/**
 * Tree-sitter based parser for Yap
 * This is the main entry point for the tree-sitter parser
 */

import Parser from "tree-sitter";
import { TreeSitterToYap } from "./processor";
import type { Module, Script } from "../parser/terms";

// Dynamic import of the language binding
let yapLanguage: any;

try {
  yapLanguage = require("./bindings/node");
} catch (err) {
  console.warn("Tree-sitter bindings not built yet. Run 'npm install' in src/parser-ts to build them.");
  // For now, we'll continue without the binding for development
}

/**
 * Parse Yap source code using tree-sitter
 */
export function parse(sourceCode: string): Module | Script {
  if (!yapLanguage) {
    throw new Error("Tree-sitter Yap language binding not available. Please build the parser first.");
  }

  const parser = new Parser();
  parser.setLanguage(yapLanguage.language());

  const tree = parser.parse(sourceCode);
  
  if (tree.rootNode.hasError) {
    // Collect error information
    const errors: string[] = [];
    const cursor = tree.walk();
    
    const visit = () => {
      const node = cursor.currentNode;
      if (node.type === "ERROR" || node.isMissing) {
        errors.push(
          `Parse error at line ${node.startPosition.row + 1}, column ${node.startPosition.column + 1}: ${node.type === "ERROR" ? "Syntax error" : `Missing ${node.type}`}`
        );
      }

      if (cursor.gotoFirstChild()) {
        do {
          visit();
        } while (cursor.gotoNextSibling());
        cursor.gotoParent();
      }
    };

    visit();

    throw new Error(`Parse errors:\n${errors.join("\n")}`);
  }

  const converter = new TreeSitterToYap(sourceCode);
  return converter.convert(tree);
}

/**
 * Parse and return the tree-sitter tree directly (for debugging)
 */
export function parseToTree(sourceCode: string): Parser.Tree {
  if (!yapLanguage) {
    throw new Error("Tree-sitter Yap language binding not available. Please build the parser first.");
  }

  const parser = new Parser();
  parser.setLanguage(yapLanguage.language());

  return parser.parse(sourceCode);
}

export { TreeSitterToYap } from "./processor";
