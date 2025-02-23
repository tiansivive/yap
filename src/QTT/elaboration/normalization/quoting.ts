import * as EB from "@qtt/elaboration";

import * as NF from ".";
import { match } from "ts-pattern";

export const quote = (imports: EB.Context["imports"], lvl: number, val: NF.Value): EB.Term => {
	return match(val)
		.with({ type: "Lit" }, ({ value }) => EB.Constructors.Lit(value))
		.with({ type: "Var" }, ({ variable }) =>
			match(variable)
				.with({ type: "Bound" }, v => EB.Constructors.Var({ type: "Bound", index: lvl - v.lvl - 1 }))
				.otherwise(v => EB.Constructors.Var(v)),
		)

		.with({ type: "Neutral" }, ({ value }) => quote(imports, lvl, value))

		.with({ type: "App" }, ({ func, arg, icit }) => EB.Constructors.App(icit, quote(imports, lvl, func), quote(imports, lvl, arg)))
		.with({ type: "Abs", binder: { type: "Lambda" } }, ({ binder, closure }) => {
			const { variable, icit } = binder;
			const val = NF.apply(imports, closure, NF.Constructors.Rigid(lvl));
			const body = quote(imports, lvl + 1, val);
			return EB.Constructors.Lambda(variable, icit, body);
		})
		.with({ type: "Abs", binder: { type: "Pi" } }, ({ binder, closure }) => {
			const {
				variable,
				icit,
				annotation: [ann, q],
			} = binder;
			const val = NF.apply(imports, closure, NF.Constructors.Rigid(lvl));
			const body = quote(imports, lvl + 1, val);
			return EB.Constructors.Pi(variable, icit, q, quote(imports, lvl, ann), body);
		})
		.with({ type: "Abs", binder: { type: "Mu" } }, ({ binder, closure }) => {
			const {
				variable,
				annotation: [ann, q],
			} = binder;
			const val = NF.apply(imports, closure, NF.Constructors.Rigid(lvl));
			const body = quote(imports, lvl + 1, val);
			return EB.Constructors.Mu(variable, quote(imports, lvl, ann), body);
		})
		.with({ type: "Row" }, ({ row }) => {
			const _quote = (r: NF.Row): EB.Row =>
				match(r)
					.with({ type: "empty" }, (): EB.Row => ({ type: "empty" }))
					.with({ type: "extension" }, ({ label, value, row }) => EB.Constructors.Extension(label, quote(imports, lvl, value), _quote(row)))
					.with({ type: "variable" }, ({ variable }): EB.Row => {
						const v = match(variable)
							.with({ type: "Bound" }, (v): EB.Variable => ({ type: "Bound", index: lvl - v.lvl - 1 }))
							.otherwise(v => v);
						return { type: "variable", variable: v };
					})
					.exhaustive();

			return EB.Constructors.Row(_quote(row));
		})
		.otherwise(nf => {
			throw new Error("Quote: Not implemented yet: " + NF.display(nf));
		});
};

export const closeVal = (ctx: EB.Context, value: NF.Value): NF.Closure => ({
	env: ctx.env,
	term: NF.quote(ctx.imports, ctx.env.length + 1, value),
});
