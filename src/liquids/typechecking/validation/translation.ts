import { match, P } from "ts-pattern";
import { BopPattern, Refinement, Term, Variable } from "../../terms.js";
import { Context } from "./context.js";

import * as HC from "./horn-constraints.js";
import { evaluate } from "../../evaluation/eval.js";
import * as X from "../../utils.js";
import { sortOf, symbolic } from "./helpers.js";

import * as Ctx from "./context.js";

const hornVars: {
	kvar: string;
	variable: string;
	sort: string;
	range: Variable[];
	ctx: Context;
}[] = [];

function translate(ctx: Context, t: Term): HC.Predicate;
function translate(ctx: Context, t: Term, r: Refinement): HC.Predicate;
function translate(ctx: Context, t: Term, r?: Refinement): HC.Predicate {
	if (r) {
		const dummy = undefined as unknown as Term;
		const pred = match(r)
			.with({ tag: "Predicate" }, ({ predicate, variable }) =>
				Ctx.extend(ctx, { tag: "Pi", variable, ann: dummy }, (ctx) =>
					translate(ctx, predicate),
				),
			)
			.with({ tag: "Template" }, ({ hornVar, variable, range }) => {
				if (!hornVars.find(({ kvar }) => kvar === hornVar)) {
					hornVars.push({
						kvar: hornVar,
						variable,
						range,
						ctx,
						sort: sortOf(ctx, t),
					});
				}
				return HC.Variable(symbolic(ctx, hornVar));
			})
			.with({ tag: "Hole" }, () => {
				throw X.error("Cannot translate hole to predicate logic", r);
			})
			.run();

		return pred;
	}

	return match(t)
		.with({ tag: "Lit", value: { tag: "Int", value: P.select() } }, HC.Number)
		.with({ tag: "Lit", value: { tag: "Bool", value: P.select() } }, HC.Boolean)
		.with(
			{ tag: "Lit", value: { tag: "String", value: P.select() } },
			HC.String,
		)
		.with({ tag: "Lit", value: { tag: "Type" } }, () => HC.Symbol("Type"))
		.with({ tag: "Lit", value: { tag: "Unit" } }, () => HC.Symbol("Unit"))
		.with({ tag: "Lit", value: { tag: "Kind" } }, () => HC.Symbol("Kind"))

		.with({ tag: "Var", variable: { tag: "Free", name: P.select() } }, (v) =>
			HC.Variable(symbolic(ctx, v)),
		)
		.with(
			{ tag: "Var", variable: { tag: "Bound", deBruijn: P.select() } },
			(i) => {
				if (i >= ctx.local.length) {
					throw `Variable not found in context: ${i}`;
				}
				return HC.Variable(symbolic(ctx, ctx.local[i].variable));
			},
		)

		.with(BopPattern("+"), (bop) =>
			HC.BinArith(translate(ctx, bop.func.arg), "+", translate(ctx, bop.arg)),
		)
		.with(BopPattern("-"), (bop) =>
			HC.BinArith(translate(ctx, bop.func.arg), "-", translate(ctx, bop.arg)),
		)
		.with(BopPattern("*"), (bop) =>
			HC.BinArith(translate(ctx, bop.func.arg), "*", translate(ctx, bop.arg)),
		)
		.with(BopPattern("/"), (bop) =>
			HC.BinArith(translate(ctx, bop.func.arg), "/", translate(ctx, bop.arg)),
		)
		.with(BopPattern("=="), (bop) =>
			HC.BinLogic(translate(ctx, bop.func.arg), "==", translate(ctx, bop.arg)),
		)
		.with(BopPattern("!="), (bop) =>
			HC.BinLogic(translate(ctx, bop.func.arg), "!=", translate(ctx, bop.arg)),
		)
		.with(BopPattern("<="), (bop) =>
			HC.BinLogic(translate(ctx, bop.func.arg), "<=", translate(ctx, bop.arg)),
		)
		.with(BopPattern(">="), (bop) =>
			HC.BinLogic(translate(ctx, bop.func.arg), ">=", translate(ctx, bop.arg)),
		)
		.with(BopPattern("<"), (bop) =>
			HC.BinLogic(translate(ctx, bop.func.arg), "<", translate(ctx, bop.arg)),
		)
		.with(BopPattern(">"), (bop) =>
			HC.BinLogic(translate(ctx, bop.func.arg), ">", translate(ctx, bop.arg)),
		)
		.with(BopPattern("&&"), (bop) =>
			HC.PAnd(translate(ctx, bop.func.arg), translate(ctx, bop.arg)),
		)
		.with(BopPattern("||"), (bop) =>
			HC.POr(translate(ctx, bop.func.arg), translate(ctx, bop.arg)),
		)

		.with({ tag: "App" }, (app) => translate(ctx, evaluate(app)))
		.with(
			{
				tag: "Neutral",
				term: { tag: "App", func: P.select("f"), arg: P.select("a") },
			},
			({ f, a }) => HC.App(translate(ctx, f), translate(ctx, a)),
		)

		.with({ tag: "Match" }, (match) => translate(ctx, evaluate(match)))

		.with({ tag: "Abs" }, (t) => {
			throw X.error("Cannot translate abstraction to predicate logic", t);
		})
		.with({ tag: "Ann" }, (t) => {
			throw X.error("Cannot translate annotation to predicate logic", t);
		})
		.with({ tag: "Refined" }, (t) => {
			throw X.error("Cannot translate refined term to predicate logic", t);
		})
		.with({ tag: "Exists" }, (t) => {
			throw X.error("Cannot translate existential to predicate logic", t);
		})
		.otherwise(() => {
			throw X.error("Translation not yet implemented", t);
		});
}

export { translate };
