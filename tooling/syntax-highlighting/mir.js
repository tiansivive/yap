// MIR stream parser for CodeMirror 6 StreamLanguage
// Derived from src/lowering/pretty.ts display format

export const mir = {
	startState() {
		return {};
	},

	token(stream) {
		if (stream.eatSpace()) {
			return null;
		}

		// Strings

		// Strings

		// Strings
		if (stream.match(/^"(?:[^"\\]|\\.)*"/)) {
			return "string";
		}

		// Numbers

		// Numbers

		// Numbers
		if (stream.match(/^[0-9]+/)) {
			return "number";
		}

		// FuncRef: &name

		// FuncRef: &name

		// FuncRef: &name
		if (stream.match(/^&[a-zA-Z_][a-zA-Z0-9_]*/)) {
			return "variableName.special";
		}

		// Indirect call: *name

		// Indirect call: *name

		// Indirect call: *name
		if (stream.match(/^(\*[a-zA-Z_][a-zA-Z0-9_]*)/)) {
			return "variableName.special";
		}

		// Block label: identifier followed by colon (at start of line or after indent)

		// Block label: identifier followed by colon (at start of line or after indent)

		// Block label: identifier followed by colon (at start of line or after indent)
		if (stream.match(/^[a-zA-Z_][a-zA-Z0-9_]*(?=\s*:)/)) {
			return "labelName";
		}

		// Operators

		// Operators

		// Operators
		if (stream.match(/^(?:->|==|!=)/)) {
			return "operator";
		}

		// Identifiers and keywords

		// Identifiers and keywords
		if (stream.match(/^[a-zA-Z_][a-zA-Z0-9_]*/)) {
			const w = stream.current();
			const keywords = ["module", "fn", "entry", "let", "return", "call", "jump", "branch", "default", "alloc", "read", "update", "declare"];
			const builtins = ["update-immutable", "update-fbip"];

			if (keywords.includes(w)) {
				return "keyword";
			}

			if (builtins.includes(w)) {
				return "keyword";
			}
			return "variableName";
		}

		// Punctuation

		// Punctuation
		if (stream.match(/^[(){}\[\];,=.:]/)) {
			return "punctuation";
		}

		stream.next();
		return null;
	},
};
