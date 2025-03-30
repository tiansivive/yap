import { match } from "ts-pattern";
import * as NF from "./index";

import * as Lit from "@yap/shared/literals";
import * as Icit from "@yap/shared/implicitness";
import * as Q from "@yap/shared/modalities/multiplicity";
import * as R from "@yap/shared/rows";

import * as EB from "@yap/elaboration";

// TODO:  add environment to properly display variables
export const display = (value: NF.Value | NF.ModalValue): string => {
	if (Array.isArray(value)) {
		const [nf, q] = value;
		return `<${Q.display(q)}> ${display(nf)}`;
	}
	return match(value)
		.with({ type: "Lit" }, ({ value }) => Lit.display(value))
		.with({ type: "Var" }, ({ variable }) =>
			match(variable)
				.with({ type: "Bound" }, ({ lvl }) => `L${lvl}`)
				.with({ type: "Meta" }, ({ val }) => `?${val}`)
				.with({ type: "Free" }, ({ name }) => name)
				.with({ type: "Label" }, ({ name }) => `:${name}`)
				.with({ type: "Foreign" }, ({ name }) => `FFI.${name}`)
				.exhaustive(),
		)
		.with({ type: "Neutral" }, ({ value }) => display(value))

		.with({ type: "Abs", binder: { type: "Mu" } }, ({ binder }) => binder.source)
		.with({ type: "Abs" }, ({ binder, closure }) => {
			const b = match(binder)
				.with({ type: "Lambda" }, ({ variable }) => `λ${variable}`)
				.with({ type: "Pi" }, ({ variable, annotation: [ty, m] }) => `Π(<${Q.display(m)}> ${variable}: ${display(ty)})`)
				.with({ type: "Mu" }, ({ variable, annotation: [ty, m] }) => `μ(<${Q.display(m)}> ${variable}: ${display(ty)})`)
				.exhaustive();

			const arr = binder.type !== "Mu" && binder.icit === "Implicit" ? "=>" : "->";
			return `${b} ${arr} ${EB.Display.Term(closure.term)}`; // TODO: Print environment
		})
		.with({ type: "App" }, ({ func, arg, icit }) => {
			const f = display(func);
			const a = display(arg);

			const wrappedFn = func.type !== "Var" && func.type !== "Lit" && func.type !== "App" ? `(${f})` : f;
			const wrappedArg = arg.type === "Abs" || arg.type === "App" ? `(${a})` : a;

			return `${wrappedFn} ${Icit.display(icit)}${wrappedArg}`;
		})
		.with({ type: "Row" }, ({ row }) =>
			R.display({
				term: display,
				var: (v: NF.Variable) => display({ type: "Var", variable: v }),
			})(row),
		)
		.exhaustive();
};
