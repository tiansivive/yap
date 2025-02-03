import fs from "fs";
import winston from "winston";

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

const label = ["Lama"];

export const push = (l: string) => label.push(l);
export const pop = () => label.pop();

export const logger = winston.createLogger({
	transports: [
		new winston.transports.File({
			filename: ".logs/debug.log",
			level: "debug",
			format: winston.format.combine(
				winston.format(info => {
					const msg = `[${label.join(".")}] ${info.message}`;
					info[Symbol.for("message")] = msg.replace(/\n/g, " ");

					const meta = Object.entries(info).reduce((acc: object, [key, value]) => {
						if (typeof key !== "symbol" && key !== "message" && key !== "level") {
							return { ...acc, [key]: value };
						}
						return acc;
					}, {});
					info.metadata = meta;
					return info;
				})(),
				winston.format.metadata(),
			),
		}),
	],
});

const fmt = winston.format.label({ label: label.join(".") });
