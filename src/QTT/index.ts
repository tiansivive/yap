import Grammar from "./parser/grammar";

import Nearley from "nearley";

import * as Elab from "./elaborator/elaborate";
import * as Q from "../utils/quokka";

import * as R from "fp-ts/lib/Reader";
import * as W from "fp-ts/lib/Writer";

import * as P from "./elaborator/pretty";
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

	data = parser.feed(test);
	data.results.length;

	const [def] = data.results.map((x) => x.script[0].value);

	const empty: Elab.Context = {
		env: [],
		types: [],
		names: [],
	};

	const runReader = Elab.infer(def);

	const runWriter = runReader(empty);
	const [ast, cst] = runWriter();

	console.log("Term:\n", P.print(ast[0]));
	console.log("Type:\n", P.print(ast[1]));

	console.log("done");
} catch (e) {
	e;
	console.error(e);
}
