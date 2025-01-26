import fs from "fs";

export const logFilePath = ".logs/elaboration.json.log";

export const mkLogger = (filepath: string = logFilePath, opts = { start: "", end: "" }) => {
	return {
		open: (start = opts.start) => fs.writeFileSync(filepath, start),
		log: (phase: "entry" | "exit", key: string, obj: {}) => {
			const json = JSON.stringify(obj);

			const msg = phase === "entry" ? `\n"${key}": ${json.substring(0, json.length - 1)},` : `\n"${key}": ${json} },`;
			fs.appendFileSync(filepath, msg);
		},
		close: (end = opts.end) => fs.appendFileSync(filepath, end),
	};
};
