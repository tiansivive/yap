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
export const display = (value: NF.Value, zonker: EB.Zonker, metas: EB.Context["metas"]): string => {
	return match(value as NF.Value)
		.with({ type: "Lit" }, ({ value }) => Lit.display(value))
		.with({ type: "Var" }, ({ variable }) =>
			match(variable)
				.with({ type: "Bound" }, ({ lvl }) => `L${lvl}`)
				.with({ type: "Free" }, ({ name }) => name)
				.with({ type: "Label" }, ({ name }) => `:${name}`)
				.with({ type: "Foreign" }, ({ name }) => `FFI.${name}`)
				.with({ type: "Meta" }, ({ val }) => {
					const m = zonker[val] ? display(zonker[val], zonker, metas) : `?${val}`;
					return m; //options.verbose ? `(${m} :: ${display(ann, zonker)})` : m;
				})
				.exhaustive(),
		)
		.with({ type: "Neutral" }, ({ value }) => display(value, zonker, metas))

		.with({ type: "Abs", binder: { type: "Mu" } }, ({ binder }) => binder.source)
		.with({ type: "Abs" }, ({ binder, closure }) => {
			const b = match(binder)
				.with({ type: "Lambda" }, ({ variable }) => `λ${variable}`)
				.with({ type: "Pi" }, ({ variable, annotation }) => `Π(${variable}: ${display(annotation, zonker, metas)})`)
				.with({ type: "Mu" }, ({ variable, annotation }) => `μ(${variable}: ${display(annotation, zonker, metas)})`)
				.exhaustive();

			const arr = binder.type !== "Mu" && binder.icit === "Implicit" ? "=>" : "->";

			const z = compose(zonker, closure.ctx.zonker);
			return `${b} ${arr} ${EB.Display.Term(closure.term, z, metas)}`; // TODO: Print environment
		})
		.with({ type: "App" }, ({ func, arg, icit }) => {
			const f = display(func, zonker, metas);
			const a = display(arg, zonker, metas);

			const wrappedFn = func.type !== "Var" && func.type !== "Lit" && func.type !== "App" ? `(${f})` : f;
			const wrappedArg = arg.type === "Abs" || arg.type === "App" ? `(${a})` : a;

			return `${wrappedFn} ${Icit.display(icit)}${wrappedArg}`;
		})
		.with({ type: "Row" }, ({ row }) =>
			R.display({
				term: (term: NF.Value | NF.Value) => display(term, zonker, metas),
				var: (v: NF.Variable) => display(NF.mk({ type: "Var", variable: v }), zonker, metas),
			})(row),
		)
		.with({ type: "Modal" }, ({ modalities, value }) => {
			return `<${Q.display(modalities.quantity)}> ${display(value, zonker, metas)} [| ${EB.Display.Term(modalities.liquid, zonker, metas)} |]`;
		})
		.with({ type: "External" }, external => {
			const args = external.args.map(arg => `(${display(arg, zonker, metas)})`).join(" ");
			return `(${external.name}: ${args})`;
		})

		.exhaustive();
	//.exhaustive();
};
