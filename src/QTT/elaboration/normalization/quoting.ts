import * as EB from "@qtt/elaboration";

import * as NF from ".";
import { match } from "ts-pattern";

export const quote = (imports: EB.Context["imports"], lvl: number, val: NF.Value): EB.Term => {
	return match(val)
		.with({ type: "Lit" }, ({ value }) => EB.Constructors.Lit(value))
		.with({ type: "Var", variable: { type: "Bound" } }, ({ variable }) => {
			return EB.Constructors.Var({ type: "Bound", index: lvl - variable.index - 1 });
		})
		.with({ type: "Var" }, ({ variable }) => EB.Constructors.Var(variable))

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
		.with({ type: "Row" }, row => {
			throw new Error("Row quoting: Not implemented yet");
		})
		.exhaustive();
};

export const closeVal = (ctx: EB.Context, value: NF.Value): NF.Closure => ({
	env: ctx.env,
	term: NF.quote(ctx.imports, ctx.env.length + 1, value),
});
