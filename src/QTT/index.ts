import Grammar from "./parser/grammar";

import Nearley from "nearley";

import * as Elab from "./elaborator/elaborate";
import * as Con from "./elaborator/constructors";
import * as NF from "./elaborator/normalized";
import * as Q from "../utils/quokka";

import * as Src from "./parser/src";

import Shared from "./shared";

import * as P from "./elaborator/pretty";

import fs from "fs";
import { log, logFilePath } from "./elaborator/logging";
// import simple from "./__tests__/simple.lama"
// import test from "./__tests__/test.lama"

const parser = new Nearley.Parser(Nearley.Grammar.fromCompiled(Grammar));

const simple = Q.load("./src/QTT/__tests__/simple.lama");
const test = Q.load("./src/QTT/__tests__/test.lama");

try {
	let data;
	// data = parser.feed(simple)
	// data.results.length
	// data.results

	// wipe log file
	fs.writeFileSync(logFilePath, "{\n");

	data = parser.feed(test);
	data.results.length;

	const empty: Elab.Context = {
		env: [],
		types: [],
		names: [],
		imports: {
			Num: [Con.Term.Lit(Shared.Atom("Num")), NF.Type, []],
			Bool: [Con.Term.Lit(Shared.Atom("Bool")), NF.Type, []],
			String: [Con.Term.Lit(Shared.Atom("String")), NF.Type, []],
			Unit: [Con.Term.Lit(Shared.Atom("Unit")), NF.Type, []],
		},
	};

	const results: Array<[Elab.AST, Elab.Constraint[]]> = [];
	const [ctx] = data.results.map((x) =>
		x.script.reduce((ctx: Elab.Context, stmt: Src.Statement): Elab.Context => {
			if (stmt.type !== "let") {
				return ctx;
			}

			log("entry", stmt.variable, { statement: stmt.type });

			const runReader = Elab.infer(stmt.value);
			const runWriter = runReader(ctx);

			const result = runWriter();

			const [ast, cst] = result;
			const [tm, ty, us] = ast;

			results.push(result);

			log("exit", "result", {
				term: P.print(tm),
				type: P.displayValue(ty),
				constraint: cst.map(P.displayConstraint),
			});

			return {
				...ctx,
				imports: {
					...ctx.imports,
					[stmt.variable]: ast,
				},
			};
		}, empty),
	);

	results.forEach(([[tm, ty, us], cst]) => {
		console.log("\n\n--------------------");
		console.log("Term:\t", P.print(tm));

		console.log("--------------------");
		console.log("Type:\t", P.displayValue(ty));

		console.log("--------------------");
		console.log("Constraints:");
		const cs = cst.map((c) => "  " + P.displayConstraint(c)).join("\n");
		console.log(cs);
	});

	fs.appendFileSync(logFilePath, "\n}");

	console.log("done");
} catch (e) {
	e;
	console.error(e);
}
