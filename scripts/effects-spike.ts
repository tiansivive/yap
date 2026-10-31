import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as M from "@yap/elaboration/shared/effects";
import * as Metas from "@yap/elaboration/shared/metas";
import * as Errors from "@yap/elaboration/shared/errors";
import * as Eff from "@yap/utils/effects";
import * as Lib from "@yap/shared/lib/primitives";
import Grammar from "@yap/src/grammar";
import Nearley from "nearley";
import { readFileSync } from "node:fs";

const file = process.argv[2] ?? "examples/effects/handlers.yap";
const parser = new Nearley.Parser(Nearley.Grammar.fromCompiled({ ...Grammar, ParserStart: "Ann" }));
const parsed = parser.feed(readFileSync(file, "utf8").trim()).results;

if (parsed.length !== 1) {
	throw new Error(`Expected one expression, received ${parsed.length}`);
}
const ctx = Lib.defaultContext();
const [answer, boundary] = EB.Mod.expression({ type: "expression", value: parsed[0] }, ctx);
const [output] = Eff.run(
	function* () {
		if (answer._tag === "Left") {
			return yield* Errors.report(answer.left);
		}
		const [term] = answer.right;
		const core = process.argv.includes("--core") ? `${yield* EB.Display.Term(term)}\n\n` : "";
		const value = yield* NF.normalize(term);
		return core + (yield* NF.display(value));
	},
	[M.reader.handlers(ctx), Metas.registry.handlers(boundary.registry)],
);
console.log(output);

if (answer._tag === "Left") {
	process.exitCode = 1;
}
