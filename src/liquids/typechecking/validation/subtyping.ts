import { match, P } from "ts-pattern";
import {
	Bool,
	eq,
	Lit,
	Pi,
	Predicate,
	Refined,
	Refinement,
	Term,
	Type,
	Variable,
} from "../../terms.js";
import { Context } from "./context.js";
import { Constraint } from "./horn-constraints.js";

import _ from "lodash";

import * as Ctx from "./context.js";
import * as X from "../../utils.js";

import * as HC from "./horn-constraints.js";
import * as T from "./translation.js";
import {
	imply,
	QExists,
	QExistsPattern,
	rv,
	sortOf,
	sub,
	symbolic,
} from "./helpers.js";

import * as I from "../infer.js";

export const subtype: (ctx: Context, a: Term, b: Term) => Constraint = (
	ctx,
	a,
	b,
) => {
	// FIXME: Why is this not working?
	// const exists = QExistsPattern(P.select("x"), P.select("s"), P.select("t"))

	return match([a, b])
		.when(
			([a, b]) => a.tag === "Refined" && !X.isType(I.infer(ctx, a.term)),
			([a]) => {
				throw X.error("Cannot refine non-type", a);
			},
		)
		.when(
			([a, b]) => b.tag === "Refined" && !X.isType(I.infer(ctx, b.term)),
			([b]) => {
				throw X.error("Cannot refine non-type", b);
			},
		)
		.when(
			([a, b]) =>
				a.tag === "Refined" && b.tag === "Refined" && !eq(a.term, b.term),
			([a, b]) => {
				throw X.error("Refined types subtyping failed: not equal base types", {
					a,
					b,
				});
			},
		)

		.with([{ tag: "Refined" }, { tag: "Refined" }], ([a, b]) =>
			entail(ctx, [a.term, a.ref], [b.term, b.ref]),
		)
		.with([{ tag: "Refined" }, P.any], ([a, b]) =>
			subtype(ctx, a, Refined(b, Predicate("v", Lit(Bool(true))))),
		)
		.with([P.any, { tag: "Refined" }], ([a, b]) =>
			subtype(ctx, Refined(a, Predicate("v", Lit(Bool(true)))), b),
		)

		.with([{ tag: "Exists" }, P.any], ([{ variable, sort, term }, t]) =>
			Ctx.extend(ctx, Pi(variable, sort), (ctx) => subtype(ctx, term, t)),
		)
		.with(
			[
				{ tag: "Abs", binder: { tag: "Pi" } },
				{ tag: "Abs", binder: { tag: "Pi" } },
			],
			([a, b]) => {
				if (_.isEqual(I.infer(ctx, a.binder.ann), Lit(Type()))) {
					return Ctx.extend(ctx, a.binder, (ctx) =>
						subtype(ctx, a.body, b.body),
					);
				}
				const cin = subtype(ctx, b.binder.ann, b.binder.ann);
				const cout = subtype(ctx, a.body, b.body);

				return HC.And(cin, imply(ctx, a.binder.variable, a.binder.ann, cout));
			},
		)

		.otherwise(([a, b]) => {
			if (!eq(a, b)) {
				throw X.error("Subtyping not yet implemented", { a, b });
			}
			return HC.Predicate(HC.Boolean(true));
		});
};

export const entail: (
	ctx: Context,
	a: [Term, Refinement],
	b: [Term, Refinement],
) => Constraint = (ctx, [t1, r1], [t2, r2]) => {
	const _entail: (ctx: Context) => Constraint = (_ctx) =>
		match(_ctx)
			.with({ local: [] }, () =>
				HC.Forall(
					symbolic(_ctx, rv(r1)),
					sortOf(_ctx, t1),
					T.translate(_ctx, t1, r1),
					HC.Predicate(T.translate(_ctx, t2, sub(rv(r1), r2))),
				),
			)
			.with(
				{
					local: [
						{
							variable: P.select("x"),
							ann: { tag: "Var", variable: P.select("v") },
						},
						...P.array(P.select("rest")),
					],
				},
				({ x, v, rest }) => {
					const t = match(Ctx.lookup(_ctx, v))
						.with({ tag: "Let" }, ({ val }) => val)
						.otherwise(({ ann }) => ann);

					const c = _entail({ ..._ctx, local: rest });
					return imply(_ctx, x, t, c);
				},
			)
			.with(
				{
					local: [
						{ variable: P.select("x"), ann: P.select("t") },
						...P.array(P.select("rest")),
					],
				},
				({ x, t, rest }) => {
					const c = _entail({ ..._ctx, local: rest });
					return imply(_ctx, x, t, c);
				},
			)
			.run();

	return _entail(ctx);
};
