import { match } from "ts-pattern";
import * as NF from "../index";

import * as Lit from "@yap/shared/literals";
import * as Icit from "@yap/shared/implicitness";
import * as Q from "@yap/shared/modalities/multiplicity";
import * as R from "@yap/shared/rows";

import * as EB from "@yap/elaboration";
import { options } from "@yap/shared/config/options";
import { compose } from "../../unification";

// TODO:  add environment to properly display variables
export const display = (value: NF.Value, ctx: Pick<EB.Context, "zonker" | "metas" | "env">, opts = { deBruijn: false }): string => {
	return match(value as NF.Value)
		.with({ type: "Lit" }, ({ value }) => Lit.display(value))
		.with({ type: "Var" }, ({ variable }) =>
			match(variable)
				.with({ type: "Bound" }, ({ lvl }) => {
					const name = ctx.env[ctx.env.length - 1 - lvl]?.name.variable ?? `L${lvl}`;
					return name + (opts.deBruijn ? `#L${lvl}` : "");
				})
				.with({ type: "Free" }, ({ name }) => name)
				.with({ type: "Label" }, ({ name }) => `:${name}`)
				.with({ type: "Foreign" }, ({ name }) => `FFI.${name}`)
				.with({ type: "Meta" }, ({ val }) => {
					const m = ctx.zonker[val] ? display(ctx.zonker[val], ctx, opts) : `?${val}`;
					return m; //options.verbose ? `(${m} :: ${display(ann, zonker)})` : m;
				})
				.exhaustive(),
		)
		.with({ type: "Neutral" }, ({ value }) => display(value, ctx, opts))

		.with({ type: "Abs", binder: { type: "Mu" } }, ({ binder }) => binder.source)
		.with({ type: "Abs" }, ({ binder, closure }) => {
			const b = match(binder)
				.with({ type: "Lambda" }, ({ variable }) => `λ${variable}`)
				.with({ type: "Pi" }, ({ variable, annotation }) => `Π(${variable}: ${display(annotation, ctx, opts)})`)
				.with({ type: "Mu" }, ({ variable, annotation }) => `μ(${variable}: ${display(annotation, ctx, opts)})`)
				.exhaustive();

			const arr = binder.type !== "Mu" && binder.icit === "Implicit" ? "=>" : "->";

			const z = compose(ctx.zonker, closure.ctx.zonker);

			const extended = { ...closure.ctx, zonker: z, env: [{ name: { variable: binder.variable } }, ...closure.ctx.env] } as Pick<
				EB.Context,
				"env" | "zonker" | "metas"
			>;
			return `${b} ${arr} ${EB.Display.Term(closure.term, extended)}`; // TODO: Print environment
		})
		.with({ type: "App" }, ({ func, arg, icit }) => {
			const f = display(func, ctx, opts);
			const a = display(arg, ctx, opts);

			const wrappedFn = func.type !== "Var" && func.type !== "Lit" && func.type !== "App" ? `(${f})` : f;
			const wrappedArg = arg.type === "Abs" || arg.type === "App" ? `(${a})` : a;

			return `${wrappedFn} ${Icit.display(icit)}${wrappedArg}`;
		})
		.with({ type: "Row" }, ({ row }) =>
			R.display({
				term: (term: NF.Value | NF.Value) => display(term, ctx, opts),
				var: (v: NF.Variable) => display(NF.mk({ type: "Var", variable: v }), ctx, opts),
			})(row),
		)
		.with({ type: "Modal" }, ({ modalities, value }) => {
			return `<${Q.display(modalities.quantity)}> ${display(value, ctx, opts)} [| ${EB.Display.Term(modalities.liquid, ctx, opts)} |]`;
		})
		.with({ type: "External" }, external => {
			const args = external.args.map(arg => `(${display(arg, ctx, opts)})`).join(" ");
			return `(${external.name}: ${args})`;
		})

		.exhaustive();
	//.exhaustive();
};
