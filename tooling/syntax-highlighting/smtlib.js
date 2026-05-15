// SMT-LIB2 stream parser for CodeMirror 6 StreamLanguage

const keywords = new Set([
	"forall",
	"exists",
	"let",
	"assert",
	"check-sat",
	"set-logic",
	"declare-fun",
	"declare-const",
	"declare-sort",
	"define-fun",
	"define-sort",
	"push",
	"pop",
	"get-model",
	"get-value",
]);

const builtins = new Set(["and", "or", "not", "ite", "distinct", "true", "false"]);

const types = new Set(["Bool", "Int", "Real", "String", "BitVec", "Array", "Type"]);

export const smtlib = {
	startState() {
		return {};
	},

	token(stream) {
		if (stream.eatSpace()) {
			return null;
		}

		// Comments: ; to end of line

		// Comments: ; to end of line

		// Comments: ; to end of line
		if (stream.match(/^;.*/)) {
			return "comment";
		}

		// Strings

		// Strings

		// Strings
		if (stream.match(/^"(?:[^"\\]|\\.)*"/)) {
			return "string";
		}

		// Numbers: integer and decimal

		// Numbers: integer and decimal

		// Numbers: integer and decimal
		if (stream.match(/^[0-9]+\.[0-9]+/)) {
			return "number";
		}

		if (stream.match(/^[0-9]+/)) {
			return "number";
		}

		// Arrow / logical implication

		// Arrow / logical implication

		// Arrow / logical implication
		if (stream.match("=>")) {
			return "keyword";
		}
		if (stream.peek() === "=" && !stream.match(/^=[a-zA-Z]/, false)) {
			stream.next();
			return "keyword";
		}

		// Z3 internal names: a!1, x!1, y!1

		// Z3 internal names: a!1, x!1, y!1
		if (stream.match(/^[a-zA-Z_$][a-zA-Z0-9_$]*![0-9]+/)) {
			return "variableName.special";
		}

		// Identifiers, keywords, builtins, types

		// Identifiers, keywords, builtins, types
		if (stream.match(/^[a-zA-Z_$][a-zA-Z0-9_$-]*/)) {
			const w = stream.current();

			if (keywords.has(w)) {
				return "keyword";
			}

			if (builtins.has(w)) {
				return "keyword.special";
			}

			if (types.has(w)) {
				return "typeName";
			}
			return "variableName";
		}

		// Parentheses

		// Parentheses
		if (stream.match(/^[()]/)) {
			return "punctuation";
		}

		stream.next();
		return null;
	},
};
