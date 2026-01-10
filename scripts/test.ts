import Parser from "tree-sitter";
// @ts-ignore - may not have types yet
import Yap from "tree-sitter-yap";

const parser = new Parser();
// @ts-ignore - something is wrong with the types
parser.setLanguage(Yap);

const sourceCode = `
let f = \\x -> .x.y.z x;
`;

const tree = parser.parse(sourceCode);
console.log("Parse tree:");
console.log(tree.rootNode.toString());

// Check for errors
if (tree.rootNode.hasError) {
	console.error("Parse errors found!");
} else {
	console.log(tree.rootNode.child(0)?.child(0)?.childForFieldName("value"));
	console.log("✓ Parse successful!");
}
