import Grammar from "./parser/grammar";

import Nearley from "nearley";

import * as Q from "../utils/quokka";

import * as Src from "@qtt/src/index";
import * as EB from "@qtt/elaboration";
import * as NF from "@qtt/elaboration/normalization";
import * as Lit from "@qtt/shared/literals";
import { mkLogger } from "@qtt/shared/logging";
import * as Log from "@qtt/shared/logging";

const parser = new Nearley.Parser(Nearley.Grammar.fromCompiled(Grammar));

const simple = Q.load("./src/QTT/__tests__/simple.lama");
const test = Q.load("./src/QTT/__tests__/test.lama");
const row = Q.load("./src/QTT/__tests__/row.lama");

const logger = mkLogger();

try {
	let data;
	// data = parser.feed(simple)
	// data.results.length
	// data.results

	// wipe log file
	logger.open("{\n");
	parser.grammar.start = "Ann";
	data = parser.feed("\\x -> 1");
	const vals = data.results.map(s => s.script[0]);

	const empty: EB.Context = {
		env: [],
		types: [],
		names: [],
		imports: {
			Num: [EB.Constructors.Lit(Lit.Atom("Num")), NF.Type, []],
			Bool: [EB.Constructors.Lit(Lit.Atom("Bool")), NF.Type, []],
			String: [EB.Constructors.Lit(Lit.Atom("String")), NF.Type, []],
			Unit: [EB.Constructors.Lit(Lit.Atom("Unit")), NF.Type, []],
		},
	};

	const results: Array<[EB.AST, EB.Constraint[]]> = [];
	const [ctx] = data.results.map(x =>
		x.script.reduce((ctx: EB.Context, stmt: Src.Statement): EB.Context => {
			if (stmt.type !== "let") {
				return ctx;
			}

			Log.logger.debug("Elaborating statement: " + stmt.variable, { statement: stmt.type });
			logger.log("entry", stmt.variable, { statement: stmt.type });

			const runReader = EB.infer(stmt.value);
			const runWriter = runReader(ctx);

			const result = runWriter();

			const [ast, cst] = result;
			const [tm, ty, us] = ast;

			results.push(result);

			Log.logger.debug("Result", {
				term: EB.display(tm),
				type: NF.display(ty),
				constraint: cst.map(EB.displayConstraint),
			});
			logger.log("exit", "result", {
				term: EB.display(tm),
				type: NF.display(ty),
				constraint: cst.map(EB.displayConstraint),
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
		console.log("Term:\t", EB.display(tm));

		console.log("--------------------");
		console.log("Type:\t", NF.display(ty));

		console.log("--------------------");
		console.log("Constraints:");
		const cs = cst.map(c => "  " + EB.displayConstraint(c)).join("\n");
		console.log(cs);
	});

	logger.close("\n}\n");

	console.log("done");
} catch (e) {
	e;
	console.error(e);
}

const writeTable = function (p: any) {
	console.log("Table length: ", p.table!.length);
	console.log("Results length: ", p.results.length);

	console.log("Parse Charts:");

	p.table.forEach((column: any, index: number) => {
		console.log("Chart: ", index++);
		column.states.forEach((state: any, stateIndex: number) => {
			console.log(stateIndex + ": " + state.toString());
		});
	});
	console.log("\n\nParse results: ");
};
