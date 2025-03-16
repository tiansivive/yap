import Grammar from "./parser/grammar";

import Nearley from "nearley";

import * as Q from "../utils/files";

import * as Src from "@qtt/src/index";
import * as EB from "@qtt/elaboration";
import * as NF from "@qtt/elaboration/normalization";
import * as Lit from "@qtt/shared/literals";
import { mkLogger } from "@qtt/shared/logging";
import * as Log from "@qtt/shared/logging";

import * as Lib from "@qtt/shared/lib/primitives";

import * as E from "fp-ts/Either";
import { displayProvenance } from "./elaboration/solver";

import * as Err from "@qtt/elaboration/errors";

const parser = null; //new Nearley.Parser(Nearley.Grammar.fromCompiled(Grammar));

const simple = Q.load("./src/QTT/__tests__/simple.lama");
const test = Q.load("./src/QTT/__tests__/test.lama");
const row = Q.load("./src/QTT/__tests__/row.lama");

try {
	let data;

	data = parser.feed(test);

	const val = data.results[0];

	const empty: EB.Context = {
		env: [],
		types: [],
		names: [],
		trace: [],
		imports: Lib.Elaborated,
	};

	const results = EB.script(val, empty);

	console.log("----------------- Result -------------------");
	// console.log("\n\n------------------------------------------");
	// console.log("--------------------------------------------");
	results.forEach(res => {
		if (E.isLeft(res)) {
			console.log(Err.display(res.left));
			res.left.provenance ? console.log(displayProvenance(res.left.provenance)) : null;
			return;
		}

		const [tm, ty, us] = res.right;

		console.log("\n---------------- Term ----------------");
		console.log(EB.Display.Statement(tm));
		// console.log("\n---------------- Type ----------------");
		// console.log(NF.display(ty));
	});

	console.log("\n\ndone");
} catch (e) {
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
