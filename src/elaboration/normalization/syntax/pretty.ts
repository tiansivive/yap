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
import * as Null from "@yap/utils";

export const display = (value: NF.Value, ctx: EB.DisplayContext, opts = { deBruijn: false }): string => {
	return match(value as NF.Value)
		.with({ type: "Lit" }, ({ value }) => Lit.display(value))
		.with({ type: "Var" }, ({ variable }) =>
			match(variable)
				.with({ type: "Bound" }, ({ lvl }) => {
					const idx = ctx.env.length - 1 - lvl;

					const name = ctx.env[idx]?.name.variable ?? `L${lvl}`;
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
			const xtended = { ...ctx, env: [{ name: { variable: binder.variable } }, ...ctx.env] } as EB.DisplayContext;
			const prettyCls = displayClosure(closure, xtended, opts);

			// const z = compose(ctx.zonker, closure.ctx.zonker);

			// const extended = { ...closure.ctx, metas: ctx.metas, zonker: z, env: [{ name: { variable: binder.variable } }, ...closure.ctx.env] } as Pick<
			// 	EB.Context,
			// 	"env" | "zonker" | "metas"
			// >;
			// const printedEnv = extended.env
			// 	.map(({ nf, name }) => {
			// 		if (nf) {
			// 			return `${name.variable} = ${NF.display(nf, extended, opts)}`;
			// 		}
			// 		return name.variable;
			// 	})
			// 	.slice(1); // remove the bound variable itself

			// let prettyEnv = printedEnv.length > 0 ? `Γ: ${printedEnv.join("; ")}` : "·";

			// return `${b} ${arr} (closure: ${EB.Display.Term(closure.term, extended, opts)} -| ${prettyEnv})`;
			return `${b} ${arr} ${prettyCls}`;
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
			return `<${Q.display(modalities.quantity)}> ${display(value, ctx, opts)} [| ${display(modalities.liquid, ctx, opts)} |]`;
		})
		.with({ type: "External" }, external => {
			const args = external.args.map(arg => `(${display(arg, ctx, opts)})`).join(" ");
			return `(${external.name}: ${args})`;
		})
		.with({ type: "Existential" }, existential => {
			const xtended = { ...ctx, env: [{ name: { variable: existential.variable } }, ...ctx.env] } as EB.DisplayContext;
			return `Σ(${existential.variable}: ${display(existential.annotation, ctx, opts)}). ${NF.display(existential.body, xtended, opts)}`;
		})

		.exhaustive();
	//.exhaustive();
};

const displayClosure = (closure: NF.Closure, ctx: EB.DisplayContext, opts = { deBruijn: false }): string => {
	const z = compose(ctx.zonker, closure.ctx.zonker);

	const extended: EB.DisplayContext = {
		...closure.ctx,
		zonker: z,
	};

	const printedEnv = extended.env.map(({ nf, name }) => {
		if (nf) {
			return `${name.variable} = ${NF.display(nf, extended, opts)}`;
		}
		return name.variable;
	});
	//.slice(0); // remove the bound variable itself

	let prettyEnv = printedEnv.length > 0 ? `Γ: ${printedEnv.join("; ")}` : "·";

	return `(closure: ${EB.Display.Term(closure.term, extended, opts)} -| ${prettyEnv})`;
};
