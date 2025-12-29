import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Lib from "@yap/shared/lib/primitives";
import * as Sub from "@yap/elaboration/unification/substitution";

import Nearley from "nearley";
import Grammar from "@yap/src/grammar";
import { V2 } from "@yap/elaboration";
import { update } from "@yap/utils";

import * as E from "fp-ts/lib/Either";
import * as F from "fp-ts/lib/function";
import * as A from "fp-ts/lib/Array";
import * as R from "fp-ts/lib/Record";

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
	EB.resetId();
	NF.resetId();

	const stmt = parseExpr(src);
	if (stmt.type !== "let") {
		throw new Error("Expected a Let statement");
	}

	const [{ constraints, metas, zonker, result }, state] = V2.Do(function* () {
		const ctx = yield* V2.ask();

		const [elaborated, ty] = yield* EB.Stmt.infer.gen(stmt);
		const { constraints, metas } = yield* V2.listen();
		const withMetas = update(ctx, "metas", prev => ({ ...prev, ...metas }));
		const { zonker, resolutions } = yield* V2.local(_ => withMetas, EB.solve(constraints));

		return { term: elaborated, type: ty, solution: zonker, resolutions };
	})(Lib.defaultContext());

	if (E.isLeft(result)) {
		throw new Error(EB.V2.display(result.left));
	}

	const { term, type, solution, resolutions } = result.right;

	const pretty = {
		term: EB.Display.Statement(term, { zonker: solution, metas, env: [], skolems: state.skolems }),
		type: NF.display(type, { zonker: solution, metas, env: [] }),
		solution: Sub.display(solution, metas),
		constraints: constraints.map(c => EB.Display.Constraint(c, { zonker: Sub.empty, metas, env: [] })),
		state: {
			skolems: F.pipe(
				state.skolems,
				R.toEntries,
				A.map(([k, v]): [string, string] => [k, EB.Display.Term(v, { zonker: solution, metas, env: [] })]),
				R.fromEntries,
			),
			nondeterminism: F.pipe(
				state.nondeterminism.solution,
				R.toEntries,
				A.map(([k, vs]): [string, string[]] => [k, vs.map(val => NF.display(val, { zonker: solution, metas, env: [] }))]),
				R.fromEntries,
			),
		},
	};
	return {
		pretty,
		structure: {
			term,
			type,
			metas,
			constraints,
			state,
			solution,
			resolutions,
		},
	};
};
