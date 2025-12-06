import Nearley from "nearley";
import Grammar from "@yap/src/grammar";

import * as F from "fp-ts/lib/function";
import * as E from "fp-ts/lib/Either";
import * as V2 from "@yap/elaboration/shared/monad.v2";
import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";

import * as Src from "@yap/src/index";

import { solve } from "@yap/elaboration/solver";
import { set, update } from "@yap/utils";

import * as Sub from "@yap/elaboration/unification/substitution";
import * as Lib from "@yap/shared/lib/primitives";

// Create a fresh parser for expressions (Ann grammar start)
export const mkParser = () => {
	const g = { ...Grammar, ParserStart: "Letdec" } as typeof Grammar;
	return new Nearley.Parser(Nearley.Grammar.fromCompiled(g), { keepHistory: true });
};

export const parseExpr = (src: string) => {
	const parser = mkParser();
	const data = parser.feed(src);
	if (data.results.length !== 1) {
		throw new Error(`Ambiguous or failed parse: expected 1 result, got ${data.results.length}`);
	}
	return data.results[0];
};

export const elaborate = (src: string) => {
	EB.resetSupply("meta");
	EB.resetSupply("var");

	const stmt = parseExpr(src);
	if (stmt.type !== "let") {
		throw new Error("Expected a Let statement");
	}

	const { result } = V2.Do(function* () {
		const ctx = yield* V2.ask();

		const [elaborated, ty, us] = yield* EB.Stmt.infer.gen(stmt);
		const { constraints, metas } = yield* V2.listen();
		const solution = yield* V2.local(
			update("metas", ms => ({ ...ms, ...metas })),
			solve(constraints),
		);
		//const tyZonked = yield* EB.zonk.gen("nf", ty, subst);
		const zonked = F.pipe(
			ctx,
			update("metas", prev => ({ ...prev, ...metas })),
			set("zonker", Sub.compose(solution.zonker, ctx.zonker)),
		);
		const [generalized, zonker] = NF.generalize(ty, elaborated.value, zonked);
		const next = update(zonked, "zonker", z => ({ ...z, ...zonker }));
		const instantiated = NF.instantiate(generalized, next);

		const xtended = EB.bind(next, { type: "Let", variable: stmt.variable }, instantiated);
		const wrapped = F.pipe(
			EB.Icit.wrapLambda(elaborated.value, instantiated, xtended),
			tm => EB.Icit.instantiate(tm, xtended, solution.resolutions),
			// EB.Icit.instantiate(elaborated.value, xtended, solution.resolutions),
			// inst => EB.Icit.generalize(inst, xtended),
			// tm => EB.Icit.wrapLambda(tm, ty, xtended),
		);

		return [wrapped, instantiated, next] as const;
	})(Lib.defaultContext());

	if (E.isLeft(result)) {
		throw new Error(EB.V2.display(result.left));
	}

	return result.right;
};
