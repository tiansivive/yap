import { AST, Constraint, Context, listen, of } from "./elaborate";

import { print as srcPrint } from "../parser/pretty";
import { print } from "./pretty";

import * as F from "fp-ts/function";

import * as Src from "../parser/src";
import * as NF from "./normalized";
import * as El from "./syntax";

let ident = 0;
export const log = {
	infer: {
		entry: (ctx: Context, ast: Src.Term) => {
			const padding = "  ".repeat(ident);
			const prefix = padding + "| ";
			const separator =
				"-------------------------------------------- Infer --------------------------------------------";
			console.log("");
			console.log(prefix + separator.substring(prefix.length));
			console.log(prefix + "Context:", ctx);
			console.log("");
			const pretty = srcPrint(ast).replace(/\n/g, `\n${padding}`);
			console.log(prefix + pretty);
			ident++;
			const { env, types } = ctx;
		},
		exit: ([tm, ty]: AST) => {
			--ident;
			const padding = "  ".repeat(ident);
			const prefix = padding + "| ";
			console.log("");
			console.log(prefix + "Result:");
			console.log(prefix + print(tm) + " : " + print(ty));

			return of(null);
		},
	},

	check: {
		entry: (term: Src.Term, annotation: NF.ModalValue) => {
			const padding = "  ".repeat(ident);
			const prefix = padding + "| ";
			const separator =
				"-------------------------------------------- Check --------------------------------------------";
			console.log("");
			console.log(prefix + separator.substring(prefix.length));
			const pretty = srcPrint(term).replace(/\n/g, `\n${padding}`);
			const prettyTy = print(annotation).replace(/\n/g, `\n${padding}`);

			console.log(prefix + pretty + "   ?=   " + prettyTy);

			ident++;
		},
		exit: ([tm, csts]: [El.Term, Constraint[]]) => {
			--ident;
			const padding = "  ".repeat(ident);
			const prefix = padding + "| ";
			console.log("");
			console.log(prefix + "Result:", print(tm));
			console.log(prefix + "Constraints:");
			csts.forEach((c) =>
				console.log(prefix + "  " + print(c.left) + " ~~ " + print(c.right)),
			);
			return tm;
		},
	},
};
