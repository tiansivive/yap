import * as EB from "@yap/elaboration";

import * as NF from ".";
import { match } from "ts-pattern";
import assert from "node:assert";

/**
 * Quotes a value in the given context and level.
 * We explicitly pass the level to avoid extending the context when quoting under binders.
 */
export const quote = (ctx: EB.Context, lvl: number, val: NF.Value): EB.Term => {
	return (
		match(val)
			.with({ type: "Lit" }, ({ value }) => EB.Constructors.Lit(value))
			.with({ type: "Var" }, ({ variable }) =>
				match(variable)
					.with({ type: "Bound" }, v => {
						return EB.Constructors.Var({ type: "Bound", index: lvl - v.lvl - 1 });
					})
					.with({ type: "Meta" }, v => {
						const zonked = ctx.zonker[v.val];
						if (zonked) {
							return quote(ctx, lvl, zonked);
						}
						return EB.Constructors.Var(v);
					})
					.otherwise(v => EB.Constructors.Var(v)),
			)

			.with({ type: "Neutral" }, ({ value }) => quote(ctx, lvl, value))
			// FIXME: This is a bit of a hack to handle match expressions.
			// QUESTION: Do we need to add a Match contructor Normal Form?
			.with(NF.Patterns.StuckMatch, ({ func, arg }) => {
				const quotedArg = NF.quote(ctx, lvl, arg);
				const match = func.closure.term;
				assert(match.type === "Match");
				return EB.Constructors.Match(quotedArg, match.alternatives);
			})
			.with({ type: "App" }, ({ func, arg, icit }) => EB.Constructors.App(icit, quote(ctx, lvl, func), quote(ctx, lvl, arg)))
			.with({ type: "Abs", binder: { type: "Lambda" } }, ({ binder, closure }) => {
				const { variable, icit, annotation } = binder;
				const val = NF.apply(binder, closure, NF.Constructors.Rigid(lvl));
				const body = quote(ctx, lvl + 1, val);
				const ann = NF.quote(ctx, lvl, annotation);
				return EB.Constructors.Lambda(variable, icit, body, ann);
			})
			.with({ type: "Abs", binder: { type: "Pi" } }, ({ binder, closure }) => {
				const { variable, icit, annotation } = binder;
				const val = NF.apply(binder, closure, NF.Constructors.Rigid(lvl));
				const body = quote(ctx, lvl + 1, val);
				const ann = NF.quote(ctx, lvl, annotation);
				return EB.Constructors.Pi(variable, icit, ann, body);
			})
			.with({ type: "Abs", binder: { type: "Mu" } }, ({ binder, closure }) => {
				const { variable, source, annotation } = binder;
				const val = NF.apply(binder, closure, NF.Constructors.Rigid(lvl));
				const body = quote(ctx, lvl + 1, val);
				const ann = NF.quote(ctx, lvl, annotation);
				return EB.Constructors.Mu(variable, source, ann, body);
			})
			.with({ type: "Abs", binder: { type: "Sigma" } }, ({ binder, closure }) => {
				const { variable, annotation } = binder;
				const val = NF.apply(binder, closure, binder.annotation);
				const body = quote(ctx, lvl + 1, val);
				const ann = NF.quote(ctx, lvl, annotation);
				return EB.Constructors.Sigma(variable, ann, body);
			})
			.with({ type: "Row" }, ({ row }) => {
				const _quote = (r: NF.Row): EB.Row =>
					match(r)
						.with({ type: "empty" }, (): EB.Row => ({ type: "empty" }))
						.with({ type: "extension" }, ({ label, value, row }) => EB.Constructors.Extension(label, quote(ctx, lvl, value), _quote(row)))
						.with({ type: "variable" }, ({ variable }): EB.Row => {
							const v = match(variable)
								.with({ type: "Bound" }, (v): EB.Variable => ({ type: "Bound", index: lvl - v.lvl - 1 }))
								.otherwise(v => v);
							return { type: "variable", variable: v };
						})
						.exhaustive();

				return EB.Constructors.Row(_quote(row));
			})
			.with({ type: "External" }, ({ name, arity, compute, args }) => {
				return args.reduce((acc, arg) => EB.Constructors.App("Explicit", acc, quote(ctx, lvl, arg)), EB.Constructors.Var({ type: "Foreign", name }));
			})
			.with({ type: "Modal" }, ({ value, modalities }) =>
				EB.Constructors.Modal(quote(ctx, lvl, value), {
					quantity: modalities.quantity,
					liquid: quote(ctx, lvl, modalities.liquid),
				}),
			)
			.otherwise(nf => {
				throw new Error("Quote: Not implemented yet: " + NF.display(nf, ctx));
			})
	);
};

export const closeVal = (ctx: EB.Context, value: NF.Value): NF.Closure => ({
	type: "Closure",
	ctx,
	term: NF.quote(ctx, ctx.env.length + 1, value),
});
