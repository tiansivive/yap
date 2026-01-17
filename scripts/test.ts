import Parser, { Query } from "tree-sitter";
// @ts-ignore - may not have types yet
import Yap from "tree-sitter-yap";

const parser = new Parser();
// @ts-ignore - something is wrong with the types
parser.setLanguage(Yap);

const sourceCode = `
  \\x -> x
`;

const tree = parser.parse(sourceCode);
console.log("Parse tree:");
console.log(tree.rootNode.text);
console.log(tree.rootNode.toString());

// Check for errors
if (tree.rootNode.hasError) {
	throw new Error("Parse errors found!");
}

const q = new Query(Yap as any, `(lambda) @lambda`);

const captures = q.captures(tree.rootNode);

console.log("Captures:");
for (const capture of captures) {
	console.log(capture.name, "->", capture.node.toString());

	const params = capture.node.childrenForFieldName("params");

	const icit = capture.node.childForFieldName("icit");
	const codomain = capture.node.childForFieldName("body");

	console.log(" Pi components:");
	console.log("  domain:", domain?.toString());
	console.log(
		"  params:",
		params?.map(d => d.toString()),
	);
	console.log("  icit:", icit?.toString());
	console.log("  icit type:", icit?.type);
	console.log("  codomain:", codomain?.toString());

	console.log("--------------------------------");
}
