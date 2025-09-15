import { match } from "ts-pattern";

import * as F from "fp-ts/lib/function";

import * as EB from ".";
import * as NF from "./normalization";
import * as M from "./shared/monad";

import * as Src from "@yap/src/index";

import { Subst, Substitute } from "./unification/substitution";
import { solve } from "./solver";

import * as Sub from "./unification/substitution";
import _ from "lodash";

import * as V2 from "./shared/monad.v2";

export const infer = V2.regen((ast: Src.Term): V2.Elaboration<EB.AST> => {
	const result = V2.track<EB.AST>(
		["src", ast, { action: "infer" }],
		V2.Do(function* () {
			const ctx = yield* V2.ask();
			const elaboration = match(ast)
				.with({ type: "var" }, ({ variable }) => EB.lookup(variable, ctx))

				.with({ type: "lit" }, EB.Lit.infer)
				.with({ type: "hole" }, EB.Hole.infer)

				.with({ type: "row" }, EB.Rows.infer)
				.with({ type: "projection" }, EB.Proj.infer)
				.with({ type: "injection" }, EB.Inj.infer)

				.with({ type: "struct" }, EB.Struct.infer)
				.with({ type: "tuple" }, EB.Tuples.infer)
				.with({ type: "list" }, EB.List.infer)
				.with({ type: "dict" }, EB.Dict.infer)
				.with({ type: "variant" }, EB.Variant.infer)
				.with({ type: "tagged" }, EB.Tagged.infer)

				.with({ type: "pi" }, { type: "arrow" }, EB.Pi.infer)
				.with({ type: "lambda" }, EB.Lambda.infer)
				.with({ type: "application" }, EB.Application.infer)

				.with({ type: "match" }, EB.Match.infer)

				.with({ type: "block" }, EB.Block.infer)
				.with({ type: "annotation" }, EB.Annotation.infer)
				.otherwise(v => {
					throw new Error("Not implemented yet: " + JSON.stringify(v));
				});

			return yield* V2.pure(elaboration);
		}),
	);
	return result;
});
// infer.gen = F.flow(infer, V2.pure)

type ZonkSwitch = {
	term: EB.Term;
	nf: NF.Value;
	closure: NF.Closure;
};

export const zonk = <K extends keyof ZonkSwitch>(key: K, term: ZonkSwitch[K], subst: Subst): V2.Elaboration<ZonkSwitch[K]> =>
	V2.Do(function* () {
		const ctx = yield* V2.ask();
		const f = Substitute(ctx)[key];
		return f(subst, term as any, 1) as ZonkSwitch[K];
	});

zonk.gen = F.flow(zonk, V2.pure);

// type Constraint =
export const run = (term: Src.Term, ctx: EB.Context) => {
	const elaboration = V2.Do(function* () {
		const result = yield* EB.infer.gen(term);
		const { constraints } = yield* V2.listen();
		const sub = yield* V2.pure(solve(constraints));
		const tm = yield* zonk.gen("term", result[0], sub);
		const ty = yield* zonk.gen("nf", result[1], sub);
		return [tm, ty, sub, constraints] as const;
	});

	return elaboration(ctx).result;
};
