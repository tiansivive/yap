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

export function infer(ast: Src.Term): M.Elaboration<EB.AST> {
	const result = M.track<EB.AST>(
		["src", ast, { action: "infer" }],

		M.chain(M.ask(), ctx => {
			return match(ast)
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
		}),
	);
	return result;
}

type ZonkSwitch = {
	term: EB.Term;
	nf: NF.Value;
	closure: NF.Closure;
};

export const zonk = <K extends keyof ZonkSwitch>(key: K, term: ZonkSwitch[K], subst: Subst): M.Elaboration<ZonkSwitch[K]> =>
	M.fmap(M.ask(), ctx => {
		const disp = Sub.display;
		const f = Substitute(ctx)[key];
		return f(subst, term as any, 1) as ZonkSwitch[K];
	});

export const run = (term: Src.Term, ctx: EB.Context) => {
	const elaboration = F.pipe(
		infer(term),
		M.listen(([[tm, ty], { constraints }]) => ({ inferred: { tm, ty }, constraints })),
		M.bind("sub", ({ constraints }) => solve(constraints)),
		M.bind("term", ({ sub, inferred }) => zonk("term", inferred.tm, sub)),
		M.bind("ty", ({ sub, inferred }) => zonk("nf", inferred.ty, sub)),
	);

	return M.run(elaboration, ctx);
};
