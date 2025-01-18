import { AST, Constraint, Context, listen, of } from "./elaborate";

import { print as srcPrint } from "../parser/pretty";
import { print } from "./pretty";

import * as F from "fp-ts/function";

import * as Src from "../parser/src";
import * as NF from "./normalized";
import * as El from "./syntax";

import fs from "fs";

export const logFilePath = ".logs/elaboration.json.log";

export const log = (phase: "entry" | "exit", key: string, obj: {}) => {
	const json = JSON.stringify(obj);

	const msg =
		phase === "entry"
			? `\n"${key}": ${json.substring(0, json.length - 1)},`
			: `\n"${key}": ${json} },`;
	fs.appendFileSync(logFilePath, msg);
};
