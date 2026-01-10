const fs = require("fs");

const print = str => {
	console.log(str);
};

const readLine = _unit => {
	const buf = Buffer.alloc(1);
	let line = "";

	// Synchronous, blocking read from stdin until newline or EOF
	// Compatible with the Yap FFI expectations (Unit -> String)
	// `readSync` blocks the Node event loop while waiting for input.
	//
	// Note: this is deliberately simple and line-oriented.
	while (true) {
		const bytes = fs.readSync(0, buf, 0, 1, null);
		if (bytes === 0) {
			break; // EOF
		}
		const ch = buf[0];
		if (ch === 10) {
			// '\n'
			break;
		}
		if (ch === 13) {
			// '\r' (Windows-style newlines) - skip
			continue;
		}
		line += String.fromCharCode(ch);
	}

	return line;
};

const stringToNum = str => {
	const n = Number(String(str).trim());
	return isNaN(n) ? 0 : n;
};

module.exports = { print, readLine, stringToNum };
