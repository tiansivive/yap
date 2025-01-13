import { match, P } from "ts-pattern";
import {
	Alternative,
	Binder,
	Bool,
	Bop,
	eq,
	Free,
	Kind,
	Let,
	Lit,
	Pattern,
	Pi,
	Predicate,
	Refined,
	Term,
	Type,
	Var,
} from "../../terms.js";
import { Context } from "./context.js";

import * as HC from "./horn-constraints.js";
import * as X from "../../utils.js";
import * as I from "../infer.js";
import * as Ctx from "./context.js";
import _ from "lodash";
import { imply, tru, TT } from "./helpers.js";
import { synth } from "./synth.js";
import { subtype } from "./subtyping.js";

export const check: (ctx: Context, e: Term, t: Term) => HC.Constraint = (
	ctx,
	e,
	t,
) => {
	return match([e, t])
		.with(
			[
				{ tag: "Abs", binder: { tag: "Lambda" } },
				{ tag: "Abs", binder: { tag: "Pi" } },
			],
			([e, t]) => {
				if (!eq(e.binder.ann, t.binder.ann)) {
					throw X.error("Checking lam against TT: Type mismatch", { e, t });
				}

				if (_.isEqual(I.infer(ctx, e.binder.ann), Lit(Kind()))) {
					return Ctx.extend(ctx, e.binder, (ctx) => check(ctx, e.body, t.body));
				}
				if (_.isEqual(I.infer(ctx, e.binder.ann), Lit(Type()))) {
					const c = Ctx.extend(ctx, e.binder, (ctx) =>
						check(ctx, e.body, t.body),
					);
					return imply(ctx, e.binder.variable, e.binder.ann, c);
				}

				throw X.error("Argument term is not a kind or type", {
					arg: e.binder.ann,
					ty: t,
				});
			},
		)
		.with([{ tag: "Abs", binder: { tag: "Let" } }, P.any], ([e, t]) => {
			const c1 = check(ctx, e.binder.val, e.binder.ann);
			const c2 = Ctx.extend(ctx, e.binder, (ctx) => check(ctx, e.body, t));
			return HC.And(c1, imply(ctx, e.binder.variable, e.binder.ann, c2));
		})
		.with([{ tag: "Match" }, P.any], ([e, ann]) => {
			const { term, constraint } = synth(ctx, e.term);
			const cs = e.alternatives.map(checkAlt(ctx, ann, { term: e, ann: term }));
			return cs.reduce((acc, c) => HC.And(acc, c), constraint);
		})
		.otherwise(([e, t]) => {
			const { term, constraint } = synth(ctx, e);
			const c = subtype(ctx, term, t);
			return HC.And(constraint, c);
		});
};

const checkAlt: (
	ctx: Context,
	t: Term,
	scrutinee: { term: Term; ann: Term },
) => (alt: Alternative) => HC.Constraint =
	(ctx, t, scrutinee) =>
	({ pattern, term }) => {
		const { constraint, annotation, binders } = synthPat(
			ctx,
			pattern,
			scrutinee.ann,
		);
		const met = meet(ctx, scrutinee.ann, annotation);

		const extended = binders.reduce(
			(acc: Context, b: Binder) => Ctx.extend(acc, b, (ctx) => ctx),
			ctx,
		);
		const altC = match(met)
			.with({ tag: "Var" }, ({ variable }) => {
				const x = Ctx.lookup(ctx, variable);
				return Ctx.extend(extended, Pi(x.variable, met), (ctx) =>
					check(ctx, term, t),
				);
			})
			.otherwise(() => check(ctx, term, t));

		const c = match(scrutinee.term)
			.with({ tag: "Var" }, ({ variable }) =>
				imply(ctx, Ctx.lookup(ctx, variable).variable, met, altC),
			)
			.otherwise(() => altC);

		const impls = binders.reduce(
			(imp: HC.Constraint, b: Binder) => imply(ctx, b.variable, b.ann, imp),
			c,
		);

		return HC.And(constraint, impls);
	};

const synthPat: (
	ctx: Context,
	p: Pattern,
	t: Term,
) => { constraint: HC.Constraint; annotation: Term; binders: Binder[] } = (
	ctx,
	p,
	t,
) => {
	return match(p)
		.with({ tag: "Lit" }, ({ value }) => {
			const { term, constraint } = synth(ctx, Lit(value));
			return { constraint, annotation: term, binders: [] };
		})
		.with({ tag: "Var" }, ({ variable }) => {
			const selfified = self(variable, t);
			return {
				constraint: tru,
				annotation: selfified,
				binders: [Let(variable, selfified, I.infer(ctx, selfified))],
			};
		})
		.otherwise(() => {
			throw X.error("Pattern synthesis not yet implemented", p);
		});
};

const meet: (ctx: Context, a: Term, b: Term) => Term = (ctx, a, b) =>
	match([a, b])
		.with(
			[
				{ tag: "Abs", binder: { tag: "Pi" } },
				{ tag: "Abs", binder: { tag: "Pi" } },
			],
			([a, b]) =>
				TT(
					a.binder.variable,
					meet(ctx, a.binder.ann, b.binder.ann),
					meet(ctx, a.body, b.body),
				),
		)
		.with(
			[
				{ tag: "Refined", ref: { tag: "Predicate" } },
				{ tag: "Refined", ref: { tag: "Predicate" } },
			],
			([a, b]) =>
				Refined(
					a.term,
					Predicate(
						a.ref.variable,
						Bop("&&", a.ref.predicate, b.ref.predicate),
					),
				),
		)
		.with([{ tag: "Refined" }, P.any], ([a, b]) =>
			meet(ctx, a, Refined(b, Predicate("v", Lit(Bool(true))))),
		)
		.with([P.any, { tag: "Refined" }], ([a, b]) =>
			meet(ctx, Refined(a, Predicate("v", Lit(Bool(true)))), b),
		)
		.otherwise(([a, b]) => {
			throw X.error("Meet not yet implemented", { a, b });
		});

const self: (v: string, t: Term) => Term = (v, t) =>
	match(t)
		.with({ tag: "Refined", ref: { tag: "Predicate" } }, ({ term, ref }) =>
			Refined(
				term,
				Predicate(
					ref.variable,
					Bop(
						"&&",
						ref.predicate,
						Bop("==", Var(Free(ref.variable)), Var(Free(v))),
					),
				),
			),
		)
		.otherwise(() => t);
