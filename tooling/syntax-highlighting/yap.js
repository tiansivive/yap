// Yap stream parser for CodeMirror 6 StreamLanguage
// Derived from src/parser/grammar.ne (moo lexer) + elaboration/NF display patterns

export const yap = {
	startState() {
		return { inString: false };
	},

	token(stream, state) {
		if (stream.eatSpace()) {
			return null;
		}

		// Strings

		// Strings

		// Strings
		if (stream.match(/^"(?:\\["bfnrt\/\\]|\\u[a-fA-F0-9]{4}|[^"\\])*"/)) {
			return "string";
		}

		// Numbers

		// Numbers

		// Numbers
		if (stream.match(/^[0-9]+/)) {
			return "number";
		}

		// De Bruijn annotations: #I3, #L2

		// De Bruijn annotations: #I3, #L2

		// De Bruijn annotations: #I3, #L2
		if (stream.match(/^#[IL][0-9]+/)) {
			return "meta";
		}

		// Atoms / labels: :name

		// Atoms / labels: :name

		// Atoms / labels: :name
		if (stream.match(/^:[a-zA-Z][a-zA-Z0-9]*/)) {
			return "atom";
		}

		// Meta variables: ?3, (?3 :: ...)

		// Meta variables: ?3, (?3 :: ...)

		// Meta variables: ?3, (?3 :: ...)
		if (stream.match(/^\?[0-9]+/)) {
			return "meta";
		}

		// FFI references: FFI.name

		// FFI references: FFI.name

		// FFI references: FFI.name
		if (stream.match(/^FFI\.[a-zA-Z][a-zA-Z0-9]*/)) {
			return "variableName.special";
		}

		// Operators (multi-char first)

		// Operators (multi-char first)

		// Operators (multi-char first)
		if (stream.match(/^(?:->|=>|<-|<>|\+\+|==|!=|<=|>=|\|>|<\||::)/)) {
			return "operator";
		}

		// Lambda/Pi/Sigma unicode

		// Lambda/Pi/Sigma unicode

		// Lambda/Pi/Sigma unicode
		if (stream.match(/^[λΠΣμ]/)) {
			return "keyword";
		}

		// Backslash (lambda)

		// Backslash (lambda)

		// Backslash (lambda)
		if (stream.eat("\\")) {
			return "keyword";
		}

		// Single-char operators

		// Single-char operators

		// Single-char operators
		if (stream.match(/^[+\-*/%=|!<>]/)) {
			return "operator";
		}

		// Identifiers and keywords

		// Identifiers and keywords
		if (stream.match(/^[a-zA-Z][a-zA-Z0-9]*/)) {
			const w = stream.current();
			const keywords = [
				"let",
				"match",
				"return",
				"using",
				"foreign",
				"module",
				"import",
				"export",
				"from",
				"as",
				"loop",
				"repeat",
				"if",
				"else",
				"then",
				"shift",
				"reset",
				"resume",
			];
			const types = ["Type", "Unit", "Row", "Num", "Bool", "String"];
			const builtins = ["struct", "variant", "tuple", "tagged", "true", "false"];

			if (keywords.includes(w)) {
				return "keyword";
			}

			if (types.includes(w)) {
				return "typeName";
			}

			if (builtins.includes(w)) {
				return "keyword";
			}
			return "variableName";
		}

		// Punctuation

		// Punctuation
		if (stream.match(/^[(){}\[\];,._@#]/)) {
			return "punctuation";
		}

		// Fallback

		// Fallback
		stream.next();
		return null;
	},
};
