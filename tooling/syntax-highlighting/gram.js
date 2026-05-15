// GRAM stream parser for CodeMirror 6 StreamLanguage
// Derived from src/GRAM/display.ts format

export const gram = {
	startState() {
		return { afterBracket: false };
	},

	token(stream, state) {
		if (stream.eatSpace()) {
			return null;
		}

		// Node ID: [N] or [0N]

		// Node ID: [N] or [0N]
		if (stream.match(/^\[[0-9]+\]/)) {
			state.afterBracket = true;
			return "number";
		}

		// Tag after node ID: e.g. "root", "app", "lambda", "var:bound"
		if (state.afterBracket && stream.match(/^[a-zA-Z_][a-zA-Z0-9_]*(:[a-zA-Z_][a-zA-Z0-9_]*)*/)) {
			state.afterBracket = false;
			return "typeName";
		}
		state.afterBracket = false;

		// JSON payload: {...}
		if (stream.peek() === "{") {
			let depth = 0;
			while (!stream.eol()) {
				const ch = stream.next();

				if (ch === "{") {
					depth++;
				}
				if (ch === "}") {
					depth--;

					if (depth === 0) {
						break;
					}
				}
			}
			return "meta";
		}

		// Edge label: :label_name (indented lines)

		// Edge label: :label_name (indented lines)
		if (stream.match(/^:[a-zA-Z_][a-zA-Z0-9_]*/)) {
			return "labelName";
		}

		// Arrow

		// Arrow

		// Arrow
		if (stream.match(/^->/)) {
			return "operator";
		}

		// Fallback

		// Fallback
		stream.next();
		return null;
	},
};
